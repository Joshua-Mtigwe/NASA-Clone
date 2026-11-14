import type { InputDevice } from '@/api/types';
import { Button } from '@/components/ui/button';
import type { ResponseOption } from './engine/types';

/**
 * Pointer and touch responses. Responses fire on pointerdown for timing; keyboard
 * responses come from the runner's key mapping, so these buttons are not tab stops
 * (otherwise Space would respond twice).
 */
export function ResponsePad({
  options,
  onRespond,
  disabled,
}: {
  options: ResponseOption[];
  onRespond: (value: string, device: InputDevice) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Responses">
      {options.map((o) => (
        <Button
          key={o.value}
          type="button"
          size="lg"
          variant="secondary"
          tabIndex={-1}
          disabled={disabled}
          className="min-w-24 touch-manipulation"
          onPointerDown={(e) => {
            e.preventDefault();
            onRespond(o.value, (e.pointerType || 'mouse') as InputDevice);
          }}
        >
          {o.label}
          {o.keys[0] && (
            <kbd className="ml-1 rounded border border-ink-subtle/40 px-1 text-caption text-ink-muted">
              {o.keys[0] === ' ' ? 'Space' : o.keys[0].toUpperCase()}
            </kbd>
          )}
        </Button>
      ))}
    </div>
  );
}
