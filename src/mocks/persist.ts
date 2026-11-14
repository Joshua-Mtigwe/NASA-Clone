/**
 * Mock-only durable writes. The mock database lives in memory and restarts from the
 * CSVs on every page load; the real backend persists. To keep published supportive
 * routines across a reload in mock mode, their rows are journaled in localStorage
 * and re-applied whenever their tables are loaded. Nothing else is persisted.
 */
import type { TableName } from '@/types/tables';

const KEY = 'aegis-mock-durable-rows';

type Journal = Partial<Record<TableName, Array<Record<string, unknown>>>>;

/** Primary key column of each journaled table. */
export const DURABLE_KEYS: Partial<Record<TableName, string>> = {
  daily_schedules: 'schedule_id',
  scheduled_recovery: 'scheduled_recovery_id',
  recovery_recommendations: 'recommendation_id',
};

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function read(): Journal {
  try {
    return JSON.parse(storage()?.getItem(KEY) ?? '{}') as Journal;
  } catch {
    return {};
  }
}

/** Record the latest version of a row so it survives a reload. */
export function persistRow(table: TableName, row: object): void {
  const key = DURABLE_KEYS[table];
  const store = storage();
  if (!key || !store) return;
  const journal = read();
  const rows = (journal[table] ?? []).filter(
    (r) => r[key] !== (row as Record<string, unknown>)[key],
  );
  journal[table] = [...rows, { ...row }];
  try {
    store.setItem(KEY, JSON.stringify(journal));
  } catch {
    // Storage full or blocked: the write still holds for this page session.
  }
}

/** Upsert journaled rows into freshly loaded table rows (in place). */
export function applyDurableRows(table: TableName, rows: unknown[]): void {
  const key = DURABLE_KEYS[table];
  const saved = key ? read()[table] : undefined;
  if (!key || !saved?.length) return;
  for (const row of saved) {
    const i = rows.findIndex((r) => (r as Record<string, unknown>)[key] === row[key]);
    if (i >= 0) rows[i] = { ...row };
    else rows.push({ ...row });
  }
}

export function clearDurableRows(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // ignore
  }
}
