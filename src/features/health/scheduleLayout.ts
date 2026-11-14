import type { ScheduleItem } from '@/api/types';

const MIN = 60_000;

export interface Placed {
  item: ScheduleItem;
  /** Minutes from midnight UTC of the selected date. */
  start: number;
  end: number;
  continues: boolean;
  column: number;
  columns: number;
}

/** Side-by-side columns for overlapping blocks (cluster packing, layout only). */
export function layoutDay(items: ScheduleItem[], date: string): Placed[] {
  const midnight = Date.parse(`${date}T00:00:00Z`);
  const rows = items
    .map((item) => {
      const s = Math.max(0, (Date.parse(item.start_time) - midnight) / MIN);
      const rawEnd = item.end_time
        ? (Date.parse(item.end_time) - midnight) / MIN
        : s + (item.duration_minutes ?? 15);
      const end = Math.min(24 * 60, Math.max(rawEnd, s + 15));
      return { item, start: s, end, continues: rawEnd > 24 * 60, column: 0, columns: 1 };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const placed: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((p) => p.column + 1));
    for (const p of cluster) p.columns = cols;
    placed.push(...cluster);
    cluster = [];
  };
  for (const row of rows) {
    if (row.start >= clusterEnd && cluster.length) flush();
    const used = new Set(cluster.filter((p) => p.end > row.start).map((p) => p.column));
    let col = 0;
    while (used.has(col)) col += 1;
    row.column = col;
    cluster.push(row);
    clusterEnd = Math.max(clusterEnd, row.end);
  }
  if (cluster.length) flush();
  return placed;
}
