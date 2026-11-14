import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it.each([
    ['nominal', 'Nominal'],
    ['review', 'Review'],
    ['action', 'Action needed'],
    ['no_data', 'No data'],
  ] as const)('shows text and an icon for %s, not colour alone', (status, text) => {
    const { container } = render(<StatusBadge status={status} />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByTestId(`status-icon-${status}`)).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute('data-status', status);
  });

  it('keeps the underlying status available to screen readers when the label is customised', () => {
    render(<StatusBadge status="review" label="Flagged for contextual review" />);
    expect(screen.getByText('Flagged for contextual review')).toBeInTheDocument();
    expect(screen.getByText('(status: Review)')).toHaveClass('sr-only');
  });
});
