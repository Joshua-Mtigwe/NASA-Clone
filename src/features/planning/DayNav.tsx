import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format';

export function DayNav({
  day,
}: {
  day: { date: string | null; offset: number; prev: () => void; next: () => void };
}) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="icon" onClick={day.prev} aria-label="Previous day">
        <ChevronLeft aria-hidden="true" />
      </Button>
      <span
        className="min-w-28 text-center text-label text-ink"
        data-testid="planning-date"
        aria-live="polite"
      >
        {day.date ? formatDate(day.date) : '—'}
        {day.offset === 0 && <span className="block text-caption text-ink-subtle">Today</span>}
      </span>
      <Button variant="outline" size="icon" onClick={day.next} aria-label="Next day">
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  );
}
