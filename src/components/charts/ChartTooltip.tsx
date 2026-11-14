import type { TooltipProps } from 'recharts';

/** Tooltip body: text in ink tokens, never the series colour. */
export function ChartTooltip({
  active,
  payload,
  label,
  formatLabel,
  formatValue,
}: TooltipProps<number, string> & {
  formatLabel: (label: number | string) => string;
  formatValue: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-caption shadow-md">
      <p className="text-ink-muted">{formatLabel(label as number | string)}</p>
      <p className="text-label font-medium text-ink">
        {typeof value === 'number' ? formatValue(value) : 'No data'}
      </p>
    </div>
  );
}
