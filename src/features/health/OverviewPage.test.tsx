import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { astronautsApi } from '@/api/astronauts';
import { cognitionApi } from '@/api/cognition';
import { sleepApi } from '@/api/sleep';
import { computeTaskReadiness } from '@/features/readiness/score';
import { mockState } from '@/mocks/db';
import { renderApp, setupMockApi, signInAs } from '@/test/appHarness';
import { MEASURE_ORDER, MEASURES } from './config';

setupMockApi();
beforeEach(() => {
  mockState.missionDayOverride = 25;
});

describe('Astronaut Overview', () => {
  it('shows the Task Readiness Score computed from the backend data, its insights and the Mind Companion only', async () => {
    await signInAs('astronaut');
    const now = '2027-03-25T12:00:00Z';
    const [summary, health, sleep, comparisons] = await Promise.all([
      astronautsApi.readinessSummary('AST-001'),
      astronautsApi.healthSummary('AST-001'),
      sleepApi.records({ astronaut_id: 'AST-001', from: '2027-03-22T00:00:00Z', to: now }),
      cognitionApi.comparisons({ astronaut_id: 'AST-001', from: '2027-03-18', to: '2027-03-25' }),
    ]);
    const expected = computeTaskReadiness({ asOf: now, summary, health, sleep, comparisons });
    expect(expected.status).toBe('estimated');

    renderApp('/astronaut');
    const ring = await screen.findByRole('img', {
      name: `Task readiness estimate ${expected.score} percent`,
    });
    expect(ring).toBeInTheDocument();
    expect(screen.getByTestId('readiness-progress').getAttribute('data-offset')).toBe(
      ((2 * Math.PI * 52 * (100 - expected.score!)) / 100).toFixed(3),
    );
    expect(screen.getByRole('heading', { name: 'Task Readiness Insights' })).toBeInTheDocument();
    expect(within(screen.getByTestId('insights')).getAllByRole('listitem').length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText(/not medical clearance/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'AEGIS Mind Companion' })).toBeInTheDocument();

    // Removed sections.
    expect(screen.queryByText('Daily readiness summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Latest measurements')).not.toBeInTheDocument();
    expect(screen.queryByText('Cognitive snapshot')).not.toBeInTheDocument();
  });

  it('reports the Mind Companion service as unavailable instead of inventing replies', async () => {
    await signInAs('astronaut');
    renderApp('/astronaut');
    // The test server has no Mind Companion service, exactly like a model outage.
    expect(await screen.findByTestId('mind-unavailable')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message to Mind Companion' })).toBeDisabled();
    expect(screen.queryByTestId('msg-assistant')).not.toBeInTheDocument();
  });
});

describe('Current Vitals', () => {
  it('shows the nine measures with only icon, name, value and unit', async () => {
    await signInAs('astronaut');
    const summary = await astronautsApi.healthSummary('AST-001');
    renderApp('/astronaut/health/vitals');

    await waitFor(() => expect(screen.getAllByTestId('vital-card')).toHaveLength(9));
    for (const measure of MEASURE_ORDER) {
      const card = screen.getByRole('article', { name: MEASURES[measure].label });
      const m = summary.measurements.find((x) => x.measure === measure)!;
      expect(card).toHaveTextContent(m.value === null ? '—' : /\d/);
      for (const hidden of ['Measured', 'Estimated', 'Source', 'Quality', 'Time', 'Within']) {
        expect(within(card).queryByText(new RegExp(hidden))).not.toBeInTheDocument();
      }
    }
    // No blood pressure sensor exists: a placeholder, never a number.
    expect(screen.getByRole('article', { name: 'Blood pressure' })).toHaveTextContent('—');
  });
});
