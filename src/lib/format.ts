/** Display formatting only. No calculation of scores or statistics belongs here. */

export function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits }).format(value);
}

/** `2027-03-01T08:00:00Z` -> `01 Mar 2027, 08:00 UTC` */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return 'Time not recorded';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(date)} UTC`;
}

/** `2027-03-01T08:05:00Z` -> `08:05` (UTC) */
export function formatClock(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(date);
}

/** `2027-03-25` or an ISO timestamp -> `25 Mar 2027` */
export function formatDate(value: string | null | undefined): string {
  if (!value) return 'Date not recorded';
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** Short axis label: `25 Mar 08:00` (UTC). */
export function formatAxisTime(ms: number, withTime: boolean): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
    timeZone: 'UTC',
  }).format(new Date(ms));
}

/** 409.5 -> `6 h 50 min` */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return 'No data';
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** Display units: `degC` -> `°C`, `percent` -> `%`. */
export function formatUnit(unit: string | null | undefined): string {
  if (!unit) return '';
  if (unit === 'degC') return '°C';
  if (unit === 'percent') return '%';
  return unit;
}

/** `synthetic_demo` -> `Synthetic demo` */
export function humanise(value: string | null | undefined): string {
  if (!value) return '';
  const spaced = value.replace(/_/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
