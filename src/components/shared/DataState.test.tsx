import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { DataState } from './DataState';

describe('DataState', () => {
  it('renders children only when ready, and a busy status while loading', () => {
    const { rerender } = render(
      <DataState status="loading">
        <p>Payload</p>
      </DataState>,
    );
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Payload')).not.toBeInTheDocument();

    rerender(
      <DataState status="ready">
        <p>Payload</p>
      </DataState>,
    );
    expect(screen.getByText('Payload')).toBeInTheDocument();
  });

  it('shows the error message with a working retry, but no retry for a 403', async () => {
    const onRetry = vi.fn();
    const serverError = new ApiError({
      status: 500,
      kind: 'server',
      message: 'The mission server returned an error.',
      method: 'GET',
      path: '/x',
    });
    const { rerender } = render(<DataState status="error" error={serverError} onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The mission server returned an error.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    const forbidden = new ApiError({
      status: 403,
      kind: 'forbidden',
      message: 'Your role does not have access to this information.',
      method: 'GET',
      path: '/x',
    });
    rerender(<DataState status="error" error={forbidden} onRetry={onRetry} />);
    expect(screen.getByText('Access restricted')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('distinguishes empty results from missing data', () => {
    const { rerender } = render(
      <DataState status="empty" emptyMessage="No analysis has been run yet" />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('No analysis has been run yet');

    rerender(<DataState status="no-data" />);
    expect(screen.getByRole('status')).toHaveTextContent('No data');
  });
});
