import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assessmentsApi } from '@/api/assessments';
import { mockState } from '@/mocks/db';
import { server } from '@/mocks/server';
import { renderApp, setupMockApi, signInAs } from '@/test/appHarness';

setupMockApi();
beforeEach(() => {
  mockState.missionDayOverride = 25;
});
afterEach(() => server.events.removeAllListeners());

describe('Medical Officer', () => {
  it('shows completion and data quality per astronaut up to the mission clock', async () => {
    await signInAs('medical_officer');
    const rows = await assessmentsApi.oversight();
    renderApp('/medical');
    const table = await screen.findAllByTestId('oversight-row');
    expect(table).toHaveLength(5);
    expect(table[0]).toHaveTextContent(
      `${rows[0]!.sessions_completed} of ${rows[0]!.sessions_total} sessions`,
    );
    // CSV holds all 90 days; only sessions up to day 25 count.
    expect(rows[0]!.sessions_total).toBeLessThan(584);
  });

  it('builds a programme with tests per condition and creates one template per condition', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    server.events.on('request:start', async ({ request }) => {
      if (request.method === 'POST' && request.url.endsWith('/assessments/schedule-templates'))
        bodies.push(await request.clone().json());
    });
    await signInAs('medical_officer');
    renderApp('/medical/programmes');
    const form = await screen.findByRole('form', { name: 'Protocol builder' });
    await userEvent.type(within(form).getByLabelText('Programme name'), 'Week 4 check');
    await userEvent.selectOptions(within(form).getByLabelText('Frequency'), 'weekly');
    await userEvent.type(within(form).getByLabelText('Collection starts'), '2027-03-26');
    await userEvent.type(within(form).getByLabelText('Collection ends'), '2027-04-02');
    await userEvent.click(
      within(within(form).getByTestId('condition-morning')).getByRole('checkbox'),
    );
    await userEvent.click(within(form).getByLabelText('Morning: Signal Response'));
    await userEvent.click(within(form).getByLabelText('Morning: Working Memory'));
    await userEvent.click(
      within(within(form).getByTestId('condition-after_physical_work')).getByRole('checkbox'),
    );
    await userEvent.click(within(form).getByLabelText('After physical work: System Scanner'));
    await userEvent.click(within(form).getByRole('button', { name: 'Create programme' }));

    expect(await screen.findByRole('region', { name: 'Assign programme' })).toBeInTheDocument();
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({
      assessment_condition: 'morning',
      protocol_ids: 'PVT|NBACK',
      recurrence: 'weekly',
      collection_start: '2027-03-26',
    });
    expect(bodies[1]).toMatchObject({
      assessment_condition: 'after_physical_work',
      protocol_ids: 'STROOP',
    });
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId('template-row')
          .some((r) => r.textContent?.includes('collection 2027-03-26 to 2027-04-02')),
      ).toBe(true),
    );
  });

  it('assigns a new programme to astronauts', async () => {
    await signInAs('medical_officer');
    renderApp('/medical/programmes');
    const form = await screen.findByRole('form', { name: 'Protocol builder' });
    await userEvent.type(within(form).getByLabelText('Programme name'), 'Spot check');
    await userEvent.click(
      within(within(form).getByTestId('condition-morning')).getByRole('checkbox'),
    );
    await userEvent.click(within(form).getByLabelText('Morning: Signal Response'));
    await userEvent.click(within(form).getByRole('button', { name: 'Create programme' }));
    const assign = await screen.findByRole('region', { name: 'Assign programme' });
    await userEvent.click(within(assign).getByLabelText('AST-002'));
    await userEvent.click(within(assign).getByLabelText('AST-003'));
    await userEvent.click(within(assign).getByRole('button', { name: 'Assign' }));
    expect(await within(assign).findByRole('status')).toHaveTextContent('2 assignments created');
  });

  it('grants and revokes access to an assessment', async () => {
    await signInAs('medical_officer');
    const [created] = await assessmentsApi.createAssignments({
      astronaut_ids: ['AST-004'],
      template_id: 'TPL-FLIGHT',
      scheduled_at: '2027-03-25T08:00:00Z',
    });
    renderApp('/medical/access');
    const waiting = await screen.findAllByTestId('grant-row');
    const row = waiting.find((r) => r.textContent?.includes('AST-004'))!;
    await userEvent.click(within(row).getByRole('button', { name: 'Grant' }));

    await waitFor(() =>
      expect(
        screen.getAllByTestId('revoke-row').some((r) => r.textContent?.includes('AST-004')),
      ).toBe(true),
    );
    const after = await assessmentsApi.listAssignments({
      astronaut_id: 'AST-004',
      access_status: 'authorized',
    });
    expect(after.items.some((a) => a.assignment_id === created!.assignment_id)).toBe(true);

    const granted = screen
      .getAllByTestId('revoke-row')
      .find((r) => r.textContent?.includes('AST-004'))!;
    await userEvent.click(within(granted).getByRole('button', { name: 'Revoke' }));
    await waitFor(async () => {
      const revoked = await assessmentsApi.listAssignments({
        astronaut_id: 'AST-004',
        access_status: 'revoked',
      });
      expect(revoked.items.length).toBeGreaterThan(0);
    });
  });

  it('lists flagged results for contextual review, filterable by astronaut', async () => {
    await signInAs('medical_officer');
    const flagged = await assessmentsApi.flagged('AST-002');
    renderApp('/medical/assessments?astronaut=AST-002');
    const rows = await screen.findAllByTestId('flagged-row');
    expect(rows).toHaveLength(flagged.length);
    expect(rows[0]).toHaveTextContent('flagged for contextual review');
    expect(rows.every((r) => r.textContent?.includes('AST-002'))).toBe(true);
    expect(screen.getByText(/A flag is not a diagnosis/)).toBeInTheDocument();
  });
});
