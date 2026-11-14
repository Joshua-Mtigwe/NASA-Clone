import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cognitionApi } from '@/api/cognition';
import { useUi } from '@/features/shell/uiStore';
import { mockState } from '@/mocks/db';
import { server } from '@/mocks/server';
import { renderApp, setupMockApi, signInAs } from '@/test/appHarness';

setupMockApi();
beforeEach(() => {
  mockState.missionDayOverride = 25;
});
afterEach(() => server.events.removeAllListeners());

function capture(path: string) {
  const urls: URL[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith(path)) urls.push(url);
  });
  return urls;
}

const figure = (name: RegExp) => screen.findByRole('figure', { name });

describe('Cognitive Trends', () => {
  it('requests comparisons for the selected domain up to the mission day', async () => {
    const urls = capture('/cognition/comparisons');
    await signInAs('astronaut');
    renderApp('/astronaut/cognitive-trends');

    await waitFor(() => expect(urls.length).toBeGreaterThan(0));
    expect(urls[0]!.searchParams.get('cognitive_domain')).toBe('vigilance');
    expect(urls[0]!.searchParams.get('to')).toBe('2027-03-25');

    await userEvent.click(await screen.findByRole('button', { name: 'Working memory' }));
    await waitFor(() =>
      expect(urls.some((u) => u.searchParams.get('cognitive_domain') === 'working_memory')).toBe(
        true,
      ),
    );
  });

  it('changes the window with the time-range selector', async () => {
    const urls = capture('/cognition/comparisons');
    await signInAs('astronaut');
    renderApp('/astronaut/cognitive-trends');
    await waitFor(() => expect(urls.length).toBeGreaterThan(0));
    expect(urls[0]!.searchParams.get('from')).toBe('2027-02-24');

    const range = screen.getByRole('group', { name: 'Time range' });
    await userEvent.click(within(range).getByRole('button', { name: '7 d' }));
    await waitFor(() =>
      expect(urls.some((u) => u.searchParams.get('from') === '2027-03-19')).toBe(true),
    );
    await userEvent.click(within(range).getByRole('button', { name: 'Mission' }));
    await waitFor(() =>
      expect(urls.some((u) => u.searchParams.get('from') === '2027-03-01')).toBe(true),
    );
  });

  it('draws daily values against the matched reference with n, unit and flag count', async () => {
    await signInAs('astronaut');
    renderApp('/astronaut/cognitive-trends');

    const chart = await figure(/Vigilance over time/);
    await waitFor(() => expect(chart).toHaveTextContent('n = 25'));
    expect(chart).toHaveTextContent('Unit: ms');
    expect(chart).toHaveTextContent(
      /flagged for contextual review · reference matched by time of day/,
    );
    expect(
      within(chart).getByRole('img', {
        name: /25 daily results against the matched preflight reference/,
      }),
    ).toBeInTheDocument();
  });

  it('compares domains in separate panels, each in its own unit', async () => {
    await signInAs('astronaut');
    renderApp('/astronaut/cognitive-trends');

    const bars = await screen.findByTestId('domain-bars');
    const panels = await within(bars).findAllByRole('figure');
    expect(panels.length).toBe(3);
    const vigilance = panels.find((p) => p.textContent?.includes('Vigilance'))!;
    const memory = panels.find((p) => p.textContent?.includes('Working memory'))!;
    expect(vigilance).toHaveTextContent('Unit: ms');
    expect(memory).toHaveTextContent('Unit: %');
  });

  it('shows a completion heatmap cell for every day with its count', async () => {
    await signInAs('astronaut');
    const summary = await cognitionApi.summary({
      astronaut_id: 'AST-001',
      from: '2027-02-24',
      to: '2027-03-25',
    });
    renderApp('/astronaut/cognitive-trends');

    const heatmap = await screen.findByTestId('completion-heatmap');
    const cells = within(heatmap).getAllByTestId('heatmap-cell');
    expect(cells).toHaveLength(summary.completion_by_day.length);
    const last = summary.completion_by_day[summary.completion_by_day.length - 1]!;
    expect(cells[cells.length - 1]!.querySelector('title')?.textContent).toBe(
      `25 Mar 2027: ${last.sessions_completed} of ${last.sessions_expected} sessions completed`,
    );
  });

  it('plots preflight and inflight distributions with n and SD from the backend', async () => {
    await signInAs('astronaut');
    const summary = await cognitionApi.summary({
      astronaut_id: 'AST-001',
      from: '2027-02-24',
      to: '2027-03-25',
    });
    const v = summary.domains.find((d) => d.cognitive_domain === 'vigilance')!;
    renderApp('/astronaut/cognitive-trends');

    const plot = await screen.findByTestId('distribution-plot');
    const pre = within(plot).getByTestId('distribution-preflight');
    const inf = within(plot).getByTestId('distribution-inflight');
    expect(pre.querySelectorAll('circle')).toHaveLength(v.n_preflight);
    expect(inf.querySelectorAll('circle')).toHaveLength(v.n_inflight);
    expect(pre).toHaveTextContent(`n = ${v.n_preflight} · SD ${v.preflight_sd}`);
  });

  it('lists each day in the detail table with condition, quality and the flag wording', async () => {
    await signInAs('astronaut');
    const views = await cognitionApi.comparisons({
      astronaut_id: 'AST-001',
      cognitive_domain: 'vigilance',
      from: '2027-02-24',
      to: '2027-03-25',
    });
    renderApp('/astronaut/cognitive-trends');

    const rows = await screen.findAllByTestId('detail-row');
    expect(rows).toHaveLength(views.length);
    expect(rows[0]).toHaveTextContent(/valid trials · \d session/);
    const flagged = views.filter(
      (v) => v.comparison.reference_range_status === 'outside_reference',
    ).length;
    expect(screen.queryAllByText('flagged for contextual review')).toHaveLength(flagged);
  });

  it('exports the visible table as CSV', async () => {
    let blob: Blob | null = null;
    // jsdom has no object URLs; define them for this test.
    Object.assign(URL, {
      createObjectURL: (b: Blob) => {
        blob = b;
        return 'blob:test';
      },
      revokeObjectURL: () => undefined,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    await signInAs('astronaut');
    renderApp('/astronaut/cognitive-trends');

    await screen.findAllByTestId('detail-row');
    await userEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    const text = await blob!.text();
    const lines = text.split('\r\n');
    expect(lines[0]).toBe(
      'date,mission_day,cognitive_domain,metric_name,value,unit,reference_lower,reference_upper,assessment_condition,comparison_method,valid_trials,sessions_completed,reference_range_status',
    );
    expect(lines.length - 1).toBe(screen.getAllByTestId('detail-row').length);
    expect(lines[1]).toMatch(/^2027-03-25,25,vigilance,median_reaction_time_ms,/);
    click.mockRestore();
  });

  it('lets a researcher view the crew member chosen in the header', async () => {
    const urls = capture('/cognition/comparisons');
    useUi.setState({ selectedAstronautId: 'AST-003' });
    await signInAs('medical_researcher');
    renderApp('/research/cognition');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Cognition Comparison' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(urls.some((u) => u.searchParams.get('astronaut_id') === 'AST-003')).toBe(true),
    );
    expect(await screen.findByRole('button', { name: /Export CSV/ })).toBeInTheDocument();
  });
});

describe('mock cognition summary', () => {
  it('reports medians, counts and completion only up to the mission clock', async () => {
    await signInAs('astronaut');
    const s = await cognitionApi.summary({
      astronaut_id: 'AST-001',
      from: '2027-03-01',
      to: '2027-05-29',
    });
    expect(s.to).toBe('2027-03-25');
    expect(s.completion_by_day).toHaveLength(25);
    const v = s.domains.find((d) => d.cognitive_domain === 'vigilance')!;
    expect(v.n_inflight).toBe(25);
    expect(v.within_reference + v.outside_reference).toBe(25);
    expect(v.metric_unit).toBe('ms');
    expect(v.n_preflight).toBeGreaterThan(0);
  });
});
