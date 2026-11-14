import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SyntheticBadge } from './SyntheticBadge';

describe('SyntheticBadge', () => {
  it('shows "Synthetic demonstration data" when the data mode is synthetic', () => {
    render(<SyntheticBadge dataMode="synthetic_demo" />);
    expect(screen.getByRole('note')).toHaveTextContent('Synthetic demonstration data');
  });

  it('renders nothing for a non-synthetic source, and the explicit flag wins', () => {
    const { container, rerender } = render(<SyntheticBadge dataMode="live_telemetry" />);
    expect(container).toBeEmptyDOMElement();

    rerender(<SyntheticBadge dataMode="live_telemetry" isSynthetic />);
    expect(screen.getByRole('note')).toHaveTextContent('Synthetic demonstration data');
  });
});
