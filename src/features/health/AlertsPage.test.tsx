import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { astronautsApi } from '@/api/astronauts';
import { mockState } from '@/mocks/db';
import { renderApp, setupMockApi, signInAs } from '@/test/appHarness';

setupMockApi();
beforeEach(() => {
  mockState.missionDayOverride = 25;
});

describe('Alerts', () => {
  it('lists backend alerts with severity text, icon and per-item sync state', async () => {
    await signInAs('astronaut');
    const expected = await astronautsApi.alerts('AST-001');
    expect(expected.length).toBeGreaterThan(0);
    renderApp('/astronaut/alerts');

    const items = await screen.findAllByTestId('alert');
    expect(items).toHaveLength(expected.length);
    const first = items[0]!;
    expect(within(first).getByText('Review')).toBeInTheDocument();
    expect(within(first).getByTestId('status-icon-review')).toBeInTheDocument();
    expect(within(first).getByText('Synced')).toBeInTheDocument();
    expect(first).toHaveTextContent(expected[0]!.title);
    expect(first).toHaveTextContent('flagged for contextual review');
  });

  it('shows an empty state when there are no alerts', async () => {
    mockState.missionDayOverride = 1;
    await signInAs('astronaut');
    renderApp('/astronaut/alerts');
    expect(await screen.findByText('No alerts.')).toBeInTheDocument();
  });
});
