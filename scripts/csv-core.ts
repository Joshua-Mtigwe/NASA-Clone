/**
 * Pure helpers for scripts/csv-to-fixtures.ts: CSV parsing, column type
 * inference and TypeScript/fixture rendering. No file IO here so it can be tested.
 */

export type CellValue = string | number | boolean | null;
export type ColumnKind = 'number' | 'boolean' | 'string';

export interface ColumnSpec {
  name: string;
  kind: ColumnKind;
  nullable: boolean;
}

export interface ColumnarFixture {
  table: string;
  columns: string[];
  rows: CellValue[][];
}

/** RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF/LF, embedded newlines. */
export function parseCsv(text: string): { header: string[]; records: string[][] } {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
    } else {
      field += ch;
    }
    i += 1;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0] === ''));
  const [header, ...records] = nonEmpty;
  if (!header) throw new Error('CSV has no header row');
  for (const [index, record] of records.entries()) {
    if (record.length !== header.length) {
      throw new Error(
        `CSV row ${index + 2} has ${record.length} fields, header has ${header.length}`,
      );
    }
  }
  return { header: header.map((h) => h.trim()), records };
}

const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/;
const BOOLEAN_VALUES = new Set(['true', 'false', 'True', 'False', 'TRUE', 'FALSE']);

/** Infer a column's kind from every value in it. Empty string means null. */
export function inferColumn(name: string, values: string[]): ColumnSpec {
  const present = values.filter((v) => v !== '');
  const nullable = present.length < values.length || values.length === 0;
  if (present.length === 0) return { name, kind: 'string', nullable: true };
  if (present.every((v) => BOOLEAN_VALUES.has(v))) return { name, kind: 'boolean', nullable };
  if (present.every((v) => NUMBER_RE.test(v))) return { name, kind: 'number', nullable };
  return { name, kind: 'string', nullable };
}

export function coerceCell(raw: string, spec: ColumnSpec): CellValue {
  if (raw === '') return null;
  switch (spec.kind) {
    case 'number':
      return Number(raw);
    case 'boolean':
      return raw.toLowerCase() === 'true';
    case 'string':
      return raw;
  }
}

/**
 * Type hints for columns that have no values to infer from (the header-only
 * runtime tables). Only applied when a column is entirely empty; never adds columns.
 */
export const EMPTY_COLUMN_TYPE_HINTS: Record<string, Record<string, ColumnKind>> = {
  ai_inference_logs: { latency_ms: 'number' },
  analysis_results: {
    metric_value: 'number',
    sample_size: 'number',
    effect_estimate: 'number',
    confidence_interval_lower: 'number',
    confidence_interval_upper: 'number',
    p_value: 'number',
  },
  optimization_runs: { objective_value: 'number' },
  planning_effectiveness: {
    cognitive_metric_value: 'number',
    workload_balance_metric: 'number',
    task_completion_rate: 'number',
    schedule_adherence_rate: 'number',
    recovery_adherence_rate: 'number',
  },
  sync_conflicts: { local_version: 'number', remote_version: 'number' },
};

export function buildFixture(
  table: string,
  csvText: string,
  hints: Record<string, ColumnKind> = EMPTY_COLUMN_TYPE_HINTS[table] ?? {},
): {
  fixture: ColumnarFixture;
  columns: ColumnSpec[];
} {
  const { header, records } = parseCsv(csvText);
  const columns = header.map((name, c) => {
    const values = records.map((r) => r[c] ?? '');
    const spec = inferColumn(name, values);
    const hint = hints[name];
    return hint && values.every((v) => v === '') ? { ...spec, kind: hint } : spec;
  });
  const rows = records.map((r) => r.map((raw, c) => coerceCell(raw, columns[c]!)));
  return { fixture: { table, columns: header, rows }, columns };
}

/** `assessment_trials` -> `AssessmentTrialsRow` */
export function rowTypeName(table: string): string {
  return (
    table
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
      .join('') + 'Row'
  );
}

export interface TableSummary {
  table: string;
  rowCount: number;
  columns: ColumnSpec[];
}

export function renderTablesModule(tables: TableSummary[]): string {
  const sorted = [...tables].sort((a, b) => a.table.localeCompare(b.table));
  const lines: string[] = [
    '// AUTO-GENERATED by scripts/csv-to-fixtures.ts from data/csv/*.csv. Do not edit by hand.',
    '// Column names are exactly the CSV headers; types are inferred from every value.',
    '// A column with any empty cell is `| null`. Empty tables type every column `string | null`.',
    '',
  ];
  for (const t of sorted) {
    lines.push(`/** ${t.table}.csv (${t.rowCount} rows) */`);
    lines.push(`export interface ${rowTypeName(t.table)} {`);
    for (const col of t.columns) {
      lines.push(`  ${col.name}: ${col.kind}${col.nullable ? ' | null' : ''};`);
    }
    lines.push('}', '');
  }
  lines.push('export interface Tables {');
  for (const t of sorted) lines.push(`  ${t.table}: ${rowTypeName(t.table)};`);
  lines.push('}', '');
  lines.push('export type TableName = keyof Tables;', '');
  lines.push('export const TABLE_NAMES = [');
  for (const t of sorted) lines.push(`  '${t.table}',`);
  lines.push('] as const satisfies readonly TableName[];', '');
  lines.push('/** Row counts in the source CSVs at generation time. */');
  lines.push('export const TABLE_ROW_COUNTS: Record<TableName, number> = {');
  for (const t of sorted) lines.push(`  ${t.table}: ${t.rowCount},`);
  lines.push('};', '');
  lines.push('export const TABLE_COLUMNS: { [K in TableName]: readonly (keyof Tables[K])[] } = {');
  for (const t of sorted) {
    lines.push(`  ${t.table}: [${t.columns.map((c) => `'${c.name}'`).join(', ')}],`);
  }
  lines.push('};', '');
  return lines.join('\n');
}

export function renderFixtureIndex(tables: string[]): string {
  const sorted = [...tables].sort();
  const lines = [
    '// AUTO-GENERATED by scripts/csv-to-fixtures.ts. Do not edit by hand.',
    '// Each table is a separate lazily-loaded chunk so mock mode only fetches what it uses.',
    "import type { TableName } from '@/types/tables';",
    "import type { ColumnarFixture } from './columnar';",
    '',
    'export const fixtureImporters: Record<TableName, () => Promise<{ default: ColumnarFixture }>> = {',
  ];
  for (const t of sorted) lines.push(`  ${t}: () => import('./${t}.json'),`);
  lines.push('};', '');
  return lines.join('\n');
}
