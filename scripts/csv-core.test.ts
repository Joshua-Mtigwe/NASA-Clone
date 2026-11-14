// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildFixture, parseCsv, renderTablesModule } from './csv-core';

describe('csv-to-fixtures core', () => {
  it('parses quoted fields with commas, escaped quotes and CRLF line endings', () => {
    const { header, records } = parseCsv(
      'id,note\r\n1,"Systems check, part 1"\r\n2,"Said ""hold"""\r\n',
    );
    expect(header).toEqual(['id', 'note']);
    expect(records).toEqual([
      ['1', 'Systems check, part 1'],
      ['2', 'Said "hold"'],
    ]);
  });

  it('infers number, boolean, nullable and leading-zero string columns from every value', () => {
    const { fixture, columns } = buildFixture(
      'demo',
      'code,score,active,dose\n007,1.5,True,\n010,2,False,0.4\n',
    );
    expect(columns).toEqual([
      { name: 'code', kind: 'string', nullable: false },
      { name: 'score', kind: 'number', nullable: false },
      { name: 'active', kind: 'boolean', nullable: false },
      { name: 'dose', kind: 'number', nullable: true },
    ]);
    expect(fixture.rows).toEqual([
      ['007', 1.5, true, null],
      ['010', 2, false, 0.4],
    ]);
  });

  it('types an empty table from hints and renders an interface with the exact headers', () => {
    const { columns } = buildFixture('analysis_results', 'analysis_id,p_value\n');
    expect(columns).toEqual([
      { name: 'analysis_id', kind: 'string', nullable: true },
      { name: 'p_value', kind: 'number', nullable: true },
    ]);
    const source = renderTablesModule([{ table: 'analysis_results', rowCount: 0, columns }]);
    expect(source).toContain('export interface AnalysisResultsRow {');
    expect(source).toContain('  p_value: number | null;');
    expect(source).toContain("analysis_results: ['analysis_id', 'p_value'],");
  });
});
