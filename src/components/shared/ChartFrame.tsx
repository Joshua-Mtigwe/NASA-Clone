import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface ChartFrameProps {
  title: string;
  /** Unit of the plotted measure, for example "ms". Each domain keeps its own unit. */
  unit: string | null | undefined;
  /** Data source, for example "daily_cognitive_results (synthetic)". */
  source: string;
  /** Number of observations behind the chart; null when the backend did not report it. */
  sampleSize: number | null | undefined;
  /** Optional uncertainty text from the backend, for example "95% CI 0.12 to 0.40". */
  uncertainty?: string | null;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function ChartFrame({
  title,
  unit,
  source,
  sampleSize,
  uncertainty,
  description,
  children,
  className,
}: ChartFrameProps) {
  const titleId = `chart-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <Card className={cn('flex flex-col', className)}>
      <figure aria-labelledby={titleId} className="flex flex-1 flex-col">
        <CardHeader className="pb-3">
          <CardTitle id={titleId} className="flex flex-wrap items-baseline gap-x-2">
            {title}
            <span className="text-label font-normal text-ink-muted">
              {unit ? `Unit: ${unit}` : 'Unit not reported'}
            </span>
          </CardTitle>
          {description && <p className="text-sm text-ink-muted">{description}</p>}
        </CardHeader>
        <CardContent className="flex-1">{children}</CardContent>
        <figcaption className="flex flex-wrap gap-x-4 gap-y-1 border-t px-5 py-3 text-caption text-ink-subtle">
          <span>Source: {source}</span>
          <span>
            {typeof sampleSize === 'number' ? `n = ${sampleSize}` : 'Sample size not reported'}
          </span>
          {uncertainty && <span>{uncertainty}</span>}
        </figcaption>
      </figure>
    </Card>
  );
}
