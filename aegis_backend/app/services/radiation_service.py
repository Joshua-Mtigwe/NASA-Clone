"""Radiation (plan section 3, Phase 2).

Two kinds of data live in radiation_readings and must never be mixed:
  * crew readings: wearable SEN-010, dose-equivalent rate in uSv/h, accumulated dose in mSv (synthetic);
  * NASA reference: Curiosity RAD detectors on Mars, absorbed-dose rate in uGy/h, no astronaut.
Gy (absorbed dose) and Sv (dose equivalent) are different quantities; every function here
keeps them apart. organ_dose_estimates are illustrative model outputs, not validated dosimetry.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import Any, Iterable

from app.core.errors import ValidationFailed
from app.services.health_context import require_astronaut, window_dict
from app.utils.statistics import describe
from app.utils.timestamps import to_iso
from app.utils.units import is_gray, is_sievert

ORGAN_DOSE_NOTE = "Illustrative whole-body model estimate (AEGIS_DEMO_ESTIMATE); not clinically validated dosimetry."
REFERENCE_NOTE = ("NASA MSL RAD readings from the Mars surface, absorbed dose rate in uGy/h. Reference context only: "
                  "not astronaut data and not comparable with crew uSv/h without a quality-factor model.")


def validate_radiation_units(rows: Iterable[dict], expect: str) -> None:
    """Raise if any row's dose-rate unit is not in the expected family ('sievert' or 'gray')."""
    check = is_sievert if expect == "sievert" else is_gray
    bad = [r.get("radiation_reading_id") for r in rows if not check(r.get("dose_rate_unit"))]
    if bad:
        raise ValidationFailed(f"Mixed radiation units: expected {expect}, found other units", bad[:5])


def _crew_rows(conn: sqlite3.Connection, astronaut_id: str, start: str, end: str) -> list[dict]:
    rows = [dict(r) for r in conn.execute(
        """SELECT radiation_reading_id, timestamp_utc, dose_rate, dose_rate_unit, accumulated_dose,
                  accumulated_dose_unit, sensor_id, detector_location, source_type
           FROM radiation_readings
           WHERE astronaut_id = ? AND timestamp_utc BETWEEN ? AND ? ORDER BY timestamp_utc""",
        (astronaut_id, start, end))]
    validate_radiation_units(rows, "sievert")
    return rows


def get_current_radiation(conn: sqlite3.Connection, astronaut_id: str, as_of: datetime) -> dict[str, Any]:
    """Latest crew dose-rate reading and accumulated dose at or before as_of."""
    require_astronaut(conn, astronaut_id)
    rows = _crew_rows(conn, astronaut_id, "0000", to_iso(as_of))
    latest = rows[-1] if rows else None
    return {"astronaut_id": astronaut_id, "as_of": to_iso(as_of), "latest": latest,
            "status": "current" if latest else "no_data"}


def calculate_cumulative_exposure(conn: sqlite3.Connection, astronaut_id: str, start: datetime,
                                  end: datetime) -> dict[str, Any]:
    """Accumulated dose at the end of the window, dose received within it, and the daily series."""
    require_astronaut(conn, astronaut_id)
    before = conn.execute(
        """SELECT accumulated_dose, accumulated_dose_unit FROM radiation_readings
           WHERE astronaut_id = ? AND timestamp_utc < ? ORDER BY timestamp_utc DESC LIMIT 1""",
        (astronaut_id, to_iso(start))).fetchone()
    rows = _crew_rows(conn, astronaut_id, to_iso(start), to_iso(end))
    units = {r["accumulated_dose_unit"] for r in rows if r["accumulated_dose_unit"]}
    if len(units) > 1:
        raise ValidationFailed(f"Accumulated dose uses several units: {sorted(units)}")
    start_total = before["accumulated_dose"] if before else 0.0
    end_total = rows[-1]["accumulated_dose"] if rows else start_total
    return {
        "astronaut_id": astronaut_id, "window": window_dict(start, end),
        "accumulated_dose_unit": units.pop() if units else "mSv",
        "accumulated_at_end": end_total,
        "received_in_window": round((end_total or 0) - (start_total or 0), 6),
        "dose_rate_stats_uSv_per_h": describe(r["dose_rate"] for r in rows),
        "series": [{"timestamp_utc": r["timestamp_utc"], "dose_rate": r["dose_rate"],
                    "dose_rate_unit": r["dose_rate_unit"], "accumulated_dose": r["accumulated_dose"]} for r in rows],
    }


def get_organ_dose_estimates(conn: sqlite3.Connection, astronaut_id: str, start: datetime,
                             end: datetime) -> dict[str, Any]:
    require_astronaut(conn, astronaut_id)
    rows = [dict(r) for r in conn.execute(
        """SELECT estimate_id, timestamp_utc, body_region, organ_name, estimated_dose, dose_unit,
                  model_name, model_version, uncertainty
           FROM organ_dose_estimates WHERE astronaut_id = ? AND timestamp_utc BETWEEN ? AND ?
           ORDER BY timestamp_utc""", (astronaut_id, to_iso(start), to_iso(end)))]
    bad = [r["estimate_id"] for r in rows if not is_sievert(r["dose_unit"])]
    if bad:
        raise ValidationFailed("Organ dose estimates must be in sievert units", bad[:5])
    return {"astronaut_id": astronaut_id, "window": window_dict(start, end), "note": ORGAN_DOSE_NOTE,
            "estimates": rows}


def prepare_radiation_research_series(conn: sqlite3.Connection, start: datetime, end: datetime,
                                      astronaut_id: str | None = None,
                                      include_reference: bool = False) -> dict[str, Any]:
    """Daily crew dose-rate series for research, with NASA reference data in a separate block."""
    params: list[Any] = [to_iso(start), to_iso(end)]
    where = "astronaut_id IS NOT NULL AND timestamp_utc BETWEEN ? AND ?"
    if astronaut_id:
        require_astronaut(conn, astronaut_id)
        where += " AND astronaut_id = ?"
        params.append(astronaut_id)
    rows = [dict(r) for r in conn.execute(
        f"""SELECT radiation_reading_id, astronaut_id, substr(timestamp_utc, 1, 10) AS day, dose_rate,
                   dose_rate_unit, accumulated_dose
            FROM radiation_readings WHERE {where} ORDER BY astronaut_id, timestamp_utc""", params)]
    validate_radiation_units(rows, "sievert")
    result: dict[str, Any] = {
        "window": window_dict(start, end),
        "crew": {"dose_rate_unit": "uSv/h", "accumulated_dose_unit": "mSv",
                 "rows": [{k: r[k] for k in ("astronaut_id", "day", "dose_rate", "accumulated_dose")} for r in rows]},
    }
    if include_reference:
        ref = [dict(r) for r in conn.execute(
            """SELECT radiation_reading_id, timestamp_utc, dose_rate, dose_rate_unit, detector_location, sensor_id
               FROM radiation_readings WHERE astronaut_id IS NULL ORDER BY timestamp_utc""")]
        validate_radiation_units(ref, "gray")
        result["nasa_reference"] = {"note": REFERENCE_NOTE, "dose_rate_unit": "uGy/h", "rows": ref}
    return result
