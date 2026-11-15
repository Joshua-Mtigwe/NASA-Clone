import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockState } from '@/mocks/db';
import { server } from '@/mocks/server';
import { renderApp, setupMockApi, signInAs } from '@/test/appHarness';

setupMockApi();
beforeEach(() => {
  mockState.missionDayOverride = 25;
});
afterEach(() => server.events.removeAllListeners());

const MISSION_TIME = '2027-03-25T12:00:00Z';

function figure(name: string | RegExp) {
  return screen.findByRole('figure', { name });
}

describe('Vital Trends', () => {
  it('requests each series up to the mission clock and re-requests when the range changes', async () => {
    const urls: URL[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/vitals/history')) urls.push(url);
    });
    await signInAs('astronaut');
    renderApp('/astronaut/health/trends');

    const range = await screen.findByRole('group', { name: 'Time range' });
    expect(within(range).getByRole('button', { name: '7 d' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(() => expect(urls.length).toBeGreaterThanOrEqual(5));
    expect(urls.every((u) => u.searchParams.get('to') === MISSION_TIME)).toBe(true);
    expect(urls[0]!.searchParams.get('from')).toBe('2027-03-18T12:00:00Z');

    urls.length = 0;
    await userEvent.click(within(range).getByRole('button', { name: '30 d' }));
    expect(within(range).getByRole('button', { name: '30 d' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(() => expect(urls.length).toBeGreaterThanOrEqual(5));
    expect(urls[0]!.searchParams.get('from')).toBe('2027-02-23T12:00:00Z');
  });

  it('draws HRV against the personal reference with its sample size and method', async () => {
    await signInAs('astronaut');
    renderApp('/astronaut/health/trends');

    const hrv = await figure(/Heart rate variability/);
    await waitFor(() =>
      expect(hrv).toHaveTextContent(
        /Personal reference [\d.]+–[\d.]+ ms \(n = 168, method: mock_stub/,
      ),
    );
    expect(await within(hrv).findByRole('img', { name: /personal reference/ })).toBeInTheDocument();
    expect(hrv).toHaveTextContent('Source: sensor_readings · synthetic · Measured');
  });

  it('says when no personal reference exists yet instead of drawing one', async () => {
    mockState.missionDayOverride = 1;
    await signInAs('astronaut');
    renderApp('/astronaut/health/trends');

    const hrv = await figure(/Heart rate variability/);
    await waitFor(() => expect(hrv).toHaveTextContent('No personal reference available yet.'));
  });

  it('shows sleep as daily bars and as a timeline', async () => {
    await signInAs('astronaut');
    renderApp('/astronaut/health/trends');

    const bars = await figure(/Sleep duration per night/);
    await waitFor(() =>
      expect(
        within(bars).getByRole('img', { name: /Sleep duration per day, 7 days/ }),
      ).toBeInTheDocument(),
    );
    const timeline = await figure(/Sleep timeline/);
    const nights = await within(timeline).findAllByRole('listitem');
    expect(nights).toHaveLength(7);
    expect(nights[0]).toHaveAccessibleName(/Night of .+ UTC, \d+ h \d+ min asleep/);
  });

  it('keeps radiation dose rate and accumulated dose in separate charts with their own units', async () => {
    await signInAs('astronaut');
    renderApp('/astronaut/health/trends');

    const rate = await figure(/Radiation dose rate/);
    const total = await figure(/Accumulated dose/);
    await waitFor(() => expect(rate).toHaveTextContent('Unit: uSv/h'));
    await waitFor(() => expect(total).toHaveTextContent('Unit: mSv'));
    expect(rate).not.toHaveTextContent('mSv');
    expect(total).not.toHaveTextContent('uSv/h');
  });

  it('offers a data table for each chart, and No data for blood pressure', async () => {
    await signInAs('astronaut');
    renderApp('/astronaut/health/trends');

    const hr = await figure(/^Heart rates?Unit/);
    const toggle = await within(hr).findByText(/Show data table \(\d+ rows\)/);
    await userEvent.click(toggle);
    const table = within(hr).getByRole('table', { name: 'Heart rate readings' });
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(100);

    const bp = await figure(/Blood pressure/);
    expect(bp).toHaveTextContent('No data: no blood pressure readings are recorded.');
  });
});
