import { useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { REGIONS, type RegionId } from './regions';

/**
 * Keyboard selection: a radio group with a roving tab stop. Arrow keys move and
 * select; Home and End jump to the first and last region.
 */
export function RegionList({
  selected,
  onSelect,
}: {
  selected: RegionId;
  onSelect: (id: RegionId) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (index: number) => {
    const next = (index + REGIONS.length) % REGIONS.length;
    onSelect(REGIONS[next]!.id);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') move(index + 1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') move(index - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(REGIONS.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div role="radiogroup" aria-label="Body region" className="flex flex-col gap-1">
      {REGIONS.map((r, i) => {
        const checked = r.id === selected;
        return (
          <button
            key={r.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onSelect(r.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'rounded-md px-3 py-2 text-left text-sm transition-colors',
              checked
                ? 'bg-accent-muted/60 font-medium text-ink'
                : 'text-ink-muted hover:bg-navy-800',
            )}
          >
            {r.label}
          </button>
        );
      })}
      <p className="mt-2 px-1 text-caption text-ink-subtle">
        The figure faces you: its left side is on your right.
      </p>
    </div>
  );
}
