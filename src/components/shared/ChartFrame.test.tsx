import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChartFrame } from './ChartFrame';

describe('ChartFrame', () => {
  it('shows title, unit, source, sample size and uncertainty around the chart', () => {
    render(
      <ChartFrame
        title="Median reaction time"
        unit="ms"
        source="daily_cognitive_results (synthetic)"
        sampleSize={28}
        uncertainty="95% CI 274.4 to 303.6 ms"
      >
        <svg data-testid="chart" />
      </ChartFrame>,
    );
    const figure = screen.getByRole('figure', { name: /Median reaction time/ });
    expect(figure).toHaveTextContent('Unit: ms');
    expect(figure).toHaveTextContent('Source: daily_cognitive_results (synthetic)');
    expect(figure).toHaveTextContent('n = 28');
    expect(figure).toHaveTextContent('95% CI 274.4 to 303.6 ms');
    expect(screen.getByTestId('chart')).toBeInTheDocument();
  });

  it('says when the sample size or unit was not reported instead of hiding it', () => {
    render(
      <ChartFrame title="Workload" unit={null} source="activity_records" sampleSize={null}>
        <div />
      </ChartFrame>,
    );
    expect(screen.getByText('Sample size not reported')).toBeInTheDocument();
    expect(screen.getByText('Unit not reported')).toBeInTheDocument();
  });
});
