import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MeasurementCard } from './MeasurementCard';

describe('MeasurementCard', () => {
  it('shows value, unit, time, source, quality and the Measured/Estimated label', () => {
    render(
      <MeasurementCard
        label="Heart rate"
        value={54.32}
        unit="bpm"
        measuredAt="2027-03-01T08:00:00Z"
        source="synthetic"
        quality="valid"
        provenance="measured"
      />,
    );
    const card = screen.getByRole('group', { name: 'Heart rate' });
    expect(within(card).getByText('54.3')).toBeInTheDocument();
    expect(within(card).getByText('bpm')).toBeInTheDocument();
    expect(within(card).getByText('01 Mar 2027, 08:00 UTC')).toBeInTheDocument();
    expect(within(card).getByText('Synthetic')).toBeInTheDocument();
    expect(within(card).getByText('Valid')).toBeInTheDocument();
    expect(within(card).getByText('Measured')).toBeInTheDocument();
    expect(within(card).queryByText('No data')).not.toBeInTheDocument();
  });

  it('shows "No data" instead of a value when the reading is missing, and labels estimates', () => {
    const { rerender } = render(
      <MeasurementCard label="Blood pressure" value={null} unit="mmHg" />,
    );
    const card = screen.getByRole('group', { name: 'Blood pressure' });
    expect(within(card).getAllByText('No data').length).toBeGreaterThan(0);
    expect(within(card).queryByText('mmHg')).not.toBeInTheDocument();

    rerender(
      <MeasurementCard
        label="Organ dose"
        value={0.0046}
        unit="mSv"
        fractionDigits={4}
        provenance="estimated"
      />,
    );
    expect(screen.getByText('Estimated')).toBeInTheDocument();
    expect(screen.getByText('0.0046')).toBeInTheDocument();
  });
});
