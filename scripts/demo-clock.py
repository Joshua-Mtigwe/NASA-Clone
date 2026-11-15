"""Explicitly position the local demo clock; never called automatically by the app."""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "aegis_backend"))
from app.database.session import connect
from app.services.mission_simulator import jump_to_mission_day

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--day", type=int, default=25)
parser.add_argument("--hour", type=int, default=9)
args = parser.parse_args()
conn = connect()
try:
    state = jump_to_mission_day(
        conn, "RUN-DEMO-001", args.day, actor_user_id="USR-006", hour=args.hour
    )
    print(state["current_mission_time"])
finally:
    conn.close()
