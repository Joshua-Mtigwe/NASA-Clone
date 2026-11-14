/**
 * Converts every data/csv/*.csv into a typed JSON fixture for the mock API.
 *
 * Outputs:
 *   src/mocks/fixtures/<table>.json  columnar fixture { table, columns, rows }
 *   src/mocks/fixtures/index.ts      lazy importer map
 *   src/types/tables.ts              one row interface per CSV, from the real headers
 *
 * Run with `npm run fixtures` (also runs automatically before `npm run check`).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFixture,
  renderFixtureIndex,
  renderTablesModule,
  type TableSummary,
} from './csv-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const csvDir = path.join(root, 'data', 'csv');
const fixtureDir = path.join(root, 'src', 'mocks', 'fixtures');
const typesFile = path.join(root, 'src', 'types', 'tables.ts');

const files = readdirSync(csvDir)
  .filter((f) => f.toLowerCase().endsWith('.csv'))
  .sort();

if (files.length === 0) {
  console.error(`No CSV files found in ${csvDir}. Extract the CSV tables there first.`);
  process.exit(1);
}

mkdirSync(fixtureDir, { recursive: true });
mkdirSync(path.dirname(typesFile), { recursive: true });

const summaries: TableSummary[] = [];
for (const file of files) {
  const table = path.basename(file, path.extname(file));
  const { fixture, columns } = buildFixture(table, readFileSync(path.join(csvDir, file), 'utf8'));
  writeFileSync(path.join(fixtureDir, `${table}.json`), JSON.stringify(fixture));
  summaries.push({ table, rowCount: fixture.rows.length, columns });
}

writeFileSync(typesFile, renderTablesModule(summaries));
writeFileSync(path.join(fixtureDir, 'index.ts'), renderFixtureIndex(summaries.map((s) => s.table)));

const totalRows = summaries.reduce((n, s) => n + s.rowCount, 0);
console.log(`csv-to-fixtures: ${summaries.length} tables, ${totalRows} rows -> src/mocks/fixtures`);
