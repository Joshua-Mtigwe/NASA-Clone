/** Shape of every generated fixture file (see scripts/csv-to-fixtures.ts). */
export type CellValue = string | number | boolean | null;

export interface ColumnarFixture {
  table: string;
  columns: string[];
  rows: CellValue[][];
}
