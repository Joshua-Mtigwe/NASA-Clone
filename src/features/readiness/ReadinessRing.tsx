/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState } from 'react';
import { prefersReducedMotion } from '@/lib/capabilities';
import { cn } from '@/lib/utils';

export const RING_RADIUS = 52;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Stroke offset for a percentage. The circle is rotated -90° so the stroke starts at
 * the top and runs clockwise: 50 % covers exactly half the circumference.
 */
export function ringOffset(percent: number): number {
  const p = Math.min(100, Math.max(0, percent));
  return RING_CIRCUMFERENCE * (1 - p / 100);
}

/** Circular progress indicator for the readiness estimate. null shows an empty track. */
export function ReadinessRing({
  percent,
  label,
  className,
}: {
  percent: number | null;
  label: string;
  className?: string;
}) {
  const target = percent ?? 0;
  // Sweep from the previous value (0 on first render) to the new one.
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? target : 0));
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(target));
    return () => cancelAnimationFrame(frame);
  }, [target]);
  const offset = ringOffset(target);
  return (
    <div className={cn('relative aspect-square w-48 sm:w-56', className)}>
      <svg
        viewBox="0 0 120 120"
        className="h-full w-full -rotate-90"
        role="img"
        aria-label={label}
        data-testid="readiness-ring"
      >
        <defs>
          <linearGradient id="ring-stroke" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#86efac" />
            <stop offset="100%" stopColor="#4ade80" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r={RING_RADIUS} fill="none" stroke="#1c2e4f" strokeWidth="6" />
        {percent !== null && (
          <circle
            cx="60"
            cy="60"
            r={RING_RADIUS}
            fill="none"
            stroke="url(#ring-stroke)"
            strokeWidth="6"
            strokeLinecap={percent >= 100 || percent <= 0 ? 'butt' : 'round'}
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={ringOffset(shown)}
            data-testid="readiness-progress"
            data-offset={offset.toFixed(3)}
            className="transition-[stroke-dashoffset] duration-1000 ease-out motion-reduce:transition-none"
            style={{ filter: 'drop-shadow(0 0 6px rgba(74, 222, 128, 0.45))' }}
          />
        )}
      </svg>
      <div
        className="absolute inset-0 flex flex-col items-center justify-center"
        aria-hidden="true"
      >
        {percent === null ? (
          <span className="text-heading text-ink-subtle">—</span>
        ) : (
          <span className="text-5xl font-semibold tabular-nums text-ink">
            {percent}
            <span className="text-2xl text-ink-muted">%</span>
          </span>
        )}
      </div>
    </div>
  );
}
