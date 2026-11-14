// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { TABLE_COLUMNS, TABLE_ROW_COUNTS } from '@/types/tables';
import { expandFixture, loadTable } from './loader';

describe('fixture loader', () => {
  it('expands a columnar fixture into objects keyed by CSV header, and rejects ragged rows', () => {
    const rows = expandFixture<{ id: string; value: number | null }>({
      table: 'demo',
      columns: ['id', 'value'],
      rows: [
        ['A', 1.5],
        ['B', null],
      ],
    });
    expect(rows).toEqual([
      { id: 'A', value: 1.5 },
      { id: 'B', value: null },
    ]);

    expect(() => expandFixture({ table: 'demo', columns: ['id', 'value'], rows: [['A']] })).toThrow(
      /expected 2/,
    );
  });

  it('loads the real astronauts and cognitive_baselines CSVs with headers and typed values', async () => {
    const astronauts = await loadTable('astronauts');
    expect(astronauts).toHaveLength(TABLE_ROW_COUNTS.astronauts);
    expect(Object.keys(astronauts[0]!)).toEqual([...TABLE_COLUMNS.astronauts]);
    expect(astronauts.map((a) => a.astronaut_id)).toContain('AST-001');

    const baselines = await loadTable('cognitive_baselines');
    expect(baselines).toHaveLength(TABLE_ROW_COUNTS.cognitive_baselines);
    expect(typeof baselines[0]!.median_value).toBe('number');
    expect(typeof baselines[0]!.sample_size).toBe('number');
  });
});
