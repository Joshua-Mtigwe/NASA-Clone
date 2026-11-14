import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { astronautsApi } from '@/api/astronauts';
import { formatNumber } from '@/lib/format';
import { mockState } from '@/mocks/db';
import { renderApp, setupMockApi, signInAs } from '@/test/appHarness';
import { DOSE_RAMP } from './regions';

const caps = vi.hoisted(() => ({ webgl: false, reducedMotion: false }));
vi.mock('@/lib/capabilities', () => ({
  hasWebGL: () => caps.webgl,
  prefersReducedMotion: () => caps.reducedMotion,
}));
// WebGL cannot run in jsdom; the lazy 3D module is replaced with a marker.
vi.mock('./BodyMap3D', () => ({
  default: () => <div data-testid="body-map-3d">3D body</div>,
}));

setupMockApi();
beforeEach(() => {
  mockState.missionDayOverride = 25;
  caps.webgl = false;
  caps.reducedMotion = false;
});

async function openBodyMap() {
  await signInAs('astronaut');
  renderApp('/astronaut/body-map');
  const list = await screen.findByRole('radiogroup', { name: 'Body region' });
  // Let the initial whole-body panel finish loading so later updates stay inside the test.
  await screen.findByText(/uncertainty: not clinically validated/);
  return list;
}

describe('Body map', () => {
  it('selects a region by clicking the map and updates the side panel', async () => {
    await openBodyMap();
    const map = await screen.findByTestId('body-map-2d');

    await userEvent.click(map.querySelector('[data-region="chest"]')!);
    expect(screen.getByRole('radio', { name: 'Chest' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('heading', { level: 2, name: 'Chest' })).toBeInTheDocument();
    expect(map.querySelector('[data-region="chest"]')).toHaveAttribute('data-selected', 'true');
  });

  it('moves through the region list with the keyboard', async () => {
    const list = await openBodyMap();
    const whole = within(list).getByRole('radio', { name: 'Whole body' });
    expect(whole).toHaveAttribute('tabindex', '0');

    whole.focus();
    await userEvent.keyboard('{ArrowDown}');
    const head = within(list).getByRole('radio', { name: 'Head' });
    expect(head).toHaveAttribute('aria-checked', 'true');
    expect(head).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(within(list).getByRole('radio', { name: 'Right leg' })).toHaveFocus();
    expect(screen.getByRole('heading', { level: 2, name: 'Right leg' })).toBeInTheDocument();
  });

  it('shows heart rate, respiratory rate, SpO2 and ECG status for the chest', async () => {
    const list = await openBodyMap();
    const summary = await astronautsApi.healthSummary('AST-001');
    await userEvent.click(within(list).getByRole('radio', { name: 'Chest' }));

    const hr = summary.measurements.find((m) => m.measure === 'heart_rate')!;
    await waitFor(() =>
      expect(screen.getByText(`${formatNumber(hr.value!, 0)} bpm`)).toBeInTheDocument(),
    );
    expect(screen.getByText('Respiratory rate')).toBeInTheDocument();
    expect(screen.getByText('Blood oxygen (SpO2)')).toBeInTheDocument();
    expect(await screen.findByText('No data: no ECG sensor is configured')).toBeInTheDocument();
  });

  it('shows cognitive results for the head and no regional dose for the abdomen', async () => {
    const list = await openBodyMap();
    await userEvent.click(within(list).getByRole('radio', { name: 'Head' }));
    expect(await screen.findByText('Reaction time')).toBeInTheDocument();
    expect(
      screen.getAllByText(/Within reference|Flagged for contextual review/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /View cognitive trends/ })).toBeInTheDocument();

    await userEvent.click(within(list).getByRole('radio', { name: 'Abdomen' }));
    expect(
      await screen.findByText('No data: no modelled organ dose exists for this region'),
    ).toBeInTheDocument();
    expect(screen.getByText('Modelled estimate')).toBeInTheDocument();
  });

  it('shows exercise for the legs and measured dosimetry beside the modelled dose for the whole body', async () => {
    const list = await openBodyMap();
    const wholePanel = await screen.findByRole('heading', { level: 3, name: 'Personal dosimetry' });
    expect(wholePanel).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('Measured').length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText('Modelled estimate')).toBeInTheDocument();
    expect(screen.getByText(/uncertainty: not clinically validated/)).toBeInTheDocument();

    await userEvent.click(within(list).getByRole('radio', { name: 'Left leg' }));
    const activity = await screen.findByTestId('activity-list');
    expect(within(activity).getAllByRole('listitem').length).toBeGreaterThan(0);
    expect(activity).toHaveTextContent(/Scheduled exercise/);
  });

  it('falls back to 2D automatically when WebGL is unavailable', async () => {
    await openBodyMap();
    expect(await screen.findByTestId('body-map-2d')).toBeInTheDocument();
    expect(screen.queryByTestId('body-map-3d')).not.toBeInTheDocument();
    expect(
      screen.getByText('3D view unavailable: this browser does not support WebGL.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '3D' })).toBeDisabled();
  });

  it('uses 2D for reduced motion, and loads the 3D view lazily when chosen', async () => {
    caps.webgl = true;
    caps.reducedMotion = true;
    await openBodyMap();
    expect(screen.getByTestId('body-map-2d')).toBeInTheDocument();
    expect(screen.getByText(/reduced motion is requested/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: '3D' }));
    expect(await screen.findByTestId('body-map-3d')).toBeInTheDocument();
    expect(screen.queryByTestId('body-map-2d')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: '2D' }));
    expect(screen.getByTestId('body-map-2d')).toBeInTheDocument();
  });

  it('labels the radiation overlay as a modelled estimate with a scale and units', async () => {
    await openBodyMap();
    await userEvent.click(screen.getByRole('button', { name: 'Radiation overlay' }));

    const legend = await screen.findByTestId('overlay-legend');
    expect(within(legend).getByText('Modelled estimate')).toBeInTheDocument();
    expect(legend).toHaveTextContent(/not a direct measurement/);
    expect(legend).toHaveTextContent(/0 mSv/);
    expect(legend).toHaveTextContent(/Scale from 0 to [\d.]+ mSv/);
    expect(legend).toHaveTextContent('every region shows the whole-body estimate');

    const chest = screen.getByTestId('body-map-2d').querySelector('[data-region="chest"]')!;
    expect(DOSE_RAMP as readonly string[]).toContain(chest.getAttribute('fill'));
  });
});
