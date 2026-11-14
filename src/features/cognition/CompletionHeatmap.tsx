import { scaleQuantize, utcDay, utcWeek } from 'd3';
import type { CompletionDay } from '@/api/types';
import { formatDate } from '@/lib/format';

/** Sequential ramp, validated (--ordinal) on the dark surface. */
const RAMP = ['#0f6577', '#138aa0', '#2fb3cc', '#8fdeec'];
const NONE = '#1c2e4f';
const CELL = 14;
const GAP = 3;
const DAYS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];

/** Calendar heatmap of assessment completion (D3 scales, React rendering). */
export function CompletionHeatmap({ days }: { days: CompletionDay[] }) {
  if (days.length === 0) return null;
  const first = new Date(`${days[0]!.date}T00:00:00Z`);
  const firstWeek = utcWeek.floor(first);
  const max = Math.max(1, ...days.map((d) => d.sessions_expected));
  const color = scaleQuantize<string>().domain([0, max]).range(RAMP);
  const weekday = (d: Date) => (d.getUTCDay() + 6) % 7; // Monday = 0
  const weeks = utcWeek.count(firstWeek, new Date(`${days[days.length - 1]!.date}T00:00:00Z`)) + 1;
  const width = 32 + weeks * (CELL + GAP);
  const height = 7 * (CELL + GAP);

  return (
    <div className="overflow-x-auto">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Assessment completion over ${days.length} days`}
        data-testid="completion-heatmap"
      >
        {DAYS.map((d, i) => (
          <text key={i} x={0} y={i * (CELL + GAP) + CELL - 3} fontSize={10} fill="#a4b3cc">
            {d}
          </text>
        ))}
        {days.map((d) => {
          const date = new Date(`${d.date}T00:00:00Z`);
          const col = utcWeek.count(firstWeek, utcDay.floor(date));
          const fill = d.sessions_completed === 0 ? NONE : color(d.sessions_completed);
          return (
            <rect
              key={d.date}
              x={32 + col * (CELL + GAP)}
              y={weekday(date) * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={3}
              fill={fill}
              data-testid="heatmap-cell"
            >
              <title>{`${formatDate(d.date)}: ${d.sessions_completed} of ${d.sessions_expected} sessions completed`}</title>
            </rect>
          );
        })}
      </svg>
      <p className="mt-2 flex items-center gap-2 text-caption text-ink-muted">
        <span>0</span>
        <span
          className="inline-block h-3 w-3 rounded-sm"
          style={{ background: NONE }}
          aria-hidden="true"
        />
        {RAMP.map((c) => (
          <span
            key={c}
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: c }}
            aria-hidden="true"
          />
        ))}
        <span>{max} sessions</span>
      </p>
    </div>
  );
}
