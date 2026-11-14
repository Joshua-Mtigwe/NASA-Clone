import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MockApiBadge } from './MockApiBadge';

describe('MockApiBadge', () => {
  it('is visible in mock mode and absent in live mode', () => {
    const { container, rerender } = render(<MockApiBadge mode="mock" />);
    expect(screen.getByRole('note')).toHaveTextContent('Mock API');

    rerender(<MockApiBadge mode="live" />);
    expect(container).toBeEmptyDOMElement();
  });
});
