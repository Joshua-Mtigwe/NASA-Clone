import type { SleepRecordsRow } from '@/types/tables';
import { chartColors } from '@/components/charts/chartTheme';
import { formatClock, formatDate, formatMinutes } from '@/lib/format';

const DAY = 86_400_000;
const MAX_NIGHTS = 14;
const TICKS = ['12:00', '18:00', '00:00', '06:00', '12:00'];

/**
 * Sleep periods on a noon-to-noon track, one row per night. Positions are layout
 * only; durations shown are the recorded total_sleep_minutes.
 */
export function SleepTimeline({ records }: { records: SleepRecordsRow[] }) {
  const nights = [...records]
    .sort((a, b) => a.sleep_start.localeCompare(b.sleep_start))
    .slice(-MAX_NIGHTS);

  return (
    <div className="space-y-2" data-testid="sleep-timeline">
      {records.length > MAX_NIGHTS && (
        <p className="text-caption text-ink-subtle">
          Showing the last {MAX_NIGHTS} nights in range.
        </p>
      )}
      <div className="ml-24 flex justify-between text-caption text-ink-subtle" aria-hidden="true">
        {TICKS.map((t, i) => (
          <span key={i}>{t}</span>
        ))}
      </div>
      <ul className="space-y-1.5">
        {nights.map((n) => {
          const start = Date.parse(n.sleep_start);
          const noon = new Date(start);
          noon.setUTCHours(12, 0, 0, 0);
          const windowStart = start < noon.getTime() ? noon.getTime() - DAY : noon.getTime();
          const left = ((start - windowStart) / DAY) * 100;
          const width = ((Date.parse(n.sleep_end) - start) / DAY) * 100;
          const label = `Night of ${formatDate(n.sleep_start)}: ${formatClock(n.sleep_start)} to ${formatClock(n.sleep_end)} UTC, ${formatMinutes(n.total_sleep_minutes)} asleep`;
          return (
            <li key={n.sleep_id} className="flex items-center gap-2" aria-label={label}>
              <span className="shrink-0 text-caption text-ink-muted" style={{ width: '5.5rem' }}>
                {formatDate(n.sleep_start).slice(0, 6)}
              </span>
              <span className="relative h-4 flex-1 rounded-sm bg-navy-800" aria-hidden="true">
                <span
                  className="absolute inset-y-0 rounded"
                  style={{
                    left: `${Math.max(0, left)}%`,
                    width: `${Math.min(width, 100 - Math.max(0, left))}%`,
                    background: chartColors.series,
                  }}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
