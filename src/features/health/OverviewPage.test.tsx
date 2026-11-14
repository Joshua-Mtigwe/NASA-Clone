import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { astronautsApi } from '@/api/astronauts';
import { mockState } from '@/mocks/db';
import { renderApp, setupMockApi, signInAs } from '@/test/appHarness';
import { formatNumber } from '@/lib/format';
import { MEASURE_ORDER, MEASURES } from './config';

setupMockApi();
beforeEach(() => {
  mockState.missionDayOverride = 25;
});

describe('Astronaut Overview', () => {
  it('shows a card for each of the nine measures with value, unit, time, source, quality and provenance', async () => {
    await signInAs('astronaut');
    const summary = await astronautsApi.healthSummary('AST-001');
    renderApp('/astronaut');

    for (const measure of MEASURE_ORDER) {
      const card = await screen.findByRole('group', { name: MEASURES[measure].label });
      const m = summary.measurements.find((x) => x.measure === measure)!;
      if (m.value === null) {
        expect(within(card).getAllByText('No data').length).toBeGreaterThan(0);
      } else {
        expect(
          within(card).getByText(formatNumber(m.value, MEASURES[measure].fractionDigits)),
        ).toBeInTheDocument();
        expect(within(card).getByText('Measured')).toBeInTheDocument();
        expect(within(card).getByText('Time')).toBeInTheDocument();
      }
    }
    // No blood pressure sensor exists in the CSVs.
    const bp = screen.getByRole('group', { name: 'Blood pressure' });
    expect(within(bp).getAllByText('No data').length).toBeGreaterThan(0);
    expect(within(bp).queryByText('Measured')).not.toBeInTheDocument();
  });

  it('groups readiness factors by the backend status, with a battery and no percentage', async () => {
    await signInAs('astronaut');
    const readiness = await astronautsApi.readinessSummary('AST-001');
    renderApp('/astronaut');

    const region = await screen.findByRole('region', { name: 'Daily readiness summary' });
    const battery = within(region).getByTestId('readiness-battery');
    expect(battery.children).toHaveLength(readiness.factors.length);

    const within_ = readiness.factors.filter(
      (f) => f.reference_range_status === 'within_reference',
    );
    const review = readiness.factors.filter(
      (f) => f.reference_range_status === 'outside_reference',
    );
    expect(
      within(region).getByRole('heading', {
        name: `Within your personal reference (${within_.length})`,
      }),
    ).toBeInTheDocument();
    expect(
      within(region).getByRole('heading', { name: `Needs review (${review.length})` }),
    ).toBeInTheDocument();

    // Units such as SpO2 % may appear in factor values; no readiness percentage or score may.
    expect(battery.getAttribute('aria-label')).not.toMatch(/%|score/i);
    for (const h of within(region).getAllByRole('heading')) expect(h.textContent).not.toMatch(/%/);
    expect(region.textContent).not.toMatch(/healthy|readiness score|\d+\s*% ready/i);
    expect(within(region).getByText('Unverified demonstration data')).toBeInTheDocument();
  });

  it('shows the latest result per cognitive domain against its preflight reference, and switches domain', async () => {
    await signInAs('astronaut');
    renderApp('/astronaut');

    const region = await screen.findByRole('region', { name: 'Cognitive snapshot' });
    const detail = await within(region).findByTestId('cognitive-detail');
    expect(detail).toHaveTextContent('Reaction time');
    expect(detail).toHaveTextContent('ms');
    expect(detail).toHaveTextContent(/Preflight reference .+ \(n = \d+/);
    expect(
      within(detail).getByText(/Within preflight reference|Flagged for contextual review/),
    ).toBeInTheDocument();

    await userEvent.click(within(region).getByRole('button', { name: 'Working memory' }));
    expect(within(region).getByRole('button', { name: 'Working memory' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(() =>
      expect(within(region).getByTestId('cognitive-detail')).toHaveTextContent('%'),
    );

    await userEvent.click(within(region).getByRole('button', { name: 'Processing speed' }));
    expect(
      within(region).getByText(/No data: there is no processing speed result yet/),
    ).toBeInTheDocument();
    expect(within(region).getByRole('link', { name: /View cognitive trends/ })).toHaveAttribute(
      'href',
      '/astronaut/cognitive-trends',
    );
  });
});
