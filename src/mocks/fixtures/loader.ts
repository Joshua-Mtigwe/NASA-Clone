import type { TableName, Tables } from '@/types/tables';
import type { ColumnarFixture } from './columnar';
import { fixtureImporters } from './index';

/** Expand a columnar fixture into row objects keyed by the CSV header names. */
export function expandFixture<T>(fixture: ColumnarFixture): T[] {
  const { columns, rows } = fixture;
  return rows.map((row) => {
    if (row.length !== columns.length) {
      throw new Error(
        `Fixture ${fixture.table}: row has ${row.length} cells, expected ${columns.length}`,
      );
    }
    const record: Record<string, unknown> = {};
    columns.forEach((column, i) => {
      record[column] = row[i];
    });
    return record as T;
  });
}

const cache = new Map<TableName, Promise<unknown[]>>();

/** Load one table's rows. Each table is fetched at most once per session. */
export function loadTable<K extends TableName>(name: K): Promise<Tables[K][]> {
  let pending = cache.get(name);
  if (!pending) {
    pending = fixtureImporters[name]().then((mod) => expandFixture<Tables[K]>(mod.default));
    cache.set(name, pending);
  }
  return pending as Promise<Tables[K][]>;
}

export function clearFixtureCache(): void {
  cache.clear();
}
