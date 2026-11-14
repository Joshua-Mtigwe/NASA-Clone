/**
 * DOM rendering of the current stimulus. Used for preflight sessions, and for
 * Mission Mind when the PixiJS stage is unavailable. Rendering never affects timing:
 * the engine decides when a stimulus is visible.
 */
import type { PointerEvent } from 'react';
import type { InputDevice } from '@/api/types';
import { cn } from '@/lib/utils';
import type { EngineState } from './engine/types';
import { STROOP_INK, type StroopColour } from './battery/core';
import { parseRotation, ROTATION_SHAPE, SYMBOL_KEY, type SwitchRule } from './battery/extended';

export type Theme = 'standard' | 'mission';

function Shape({ angle, mirrored, label }: { angle: number; mirrored: boolean; label: string }) {
  const cells = ROTATION_SHAPE.map(([x, y]) => [mirrored ? 3 - x : x, y] as const);
  return (
    <svg viewBox="-1 -1 6 6" className="h-28 w-28" role="img" aria-label={label}>
      <g transform={`rotate(${angle} 2 2)`}>
        {cells.map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="0.94" height="0.94" rx="0.12" fill="#16a2ba" />
        ))}
      </g>
    </svg>
  );
}

function Content({ protocolId, state }: { protocolId: string; state: EngineState }) {
  const spec = state.spec;
  if (!spec || !state.stimulusVisible) {
    return protocolId === 'SYMBOL' ? <SymbolKey /> : <span className="text-ink-subtle">+</span>;
  }
  const d = spec.display;
  switch (protocolId) {
    case 'PVT':
      return (
        <span
          className="block h-28 w-28 rounded-full bg-accent shadow-[0_0_48px_#22c3dd]"
          data-testid="pvt-signal"
        />
      );
    case 'NBACK':
      return (
        <span className="font-mono text-[5rem] leading-none text-ink">{String(d.letter)}</span>
      );
    case 'STROOP':
      return (
        <span
          className="text-[4rem] font-bold leading-none"
          style={{ color: STROOP_INK[d.ink as StroopColour] }}
        >
          {String(d.word)}
        </span>
      );
    case 'SYMBOL':
      return (
        <div className="flex flex-col items-center gap-4">
          <SymbolKey />
          <span className="text-[4.5rem] leading-none text-ink">{String(d.symbol)}</span>
        </div>
      );
    case 'ROTATION': {
      const { angle, mirrored } = parseRotation(spec.stimulus_value);
      return (
        <div className="flex items-center gap-8">
          <Shape angle={0} mirrored={false} label="Reference shape" />
          <Shape angle={angle} mirrored={mirrored} label="Rotated shape" />
        </div>
      );
    }
    case 'SWITCH': {
      const rule = d.rule as SwitchRule;
      return (
        <div className="flex flex-col items-center gap-3">
          <span className="rounded-md border border-accent/50 px-3 py-1 text-label text-accent-strong">
            {rule === 'parity'
              ? 'Rule: ODD (left) / EVEN (right)'
              : 'Rule: LOW < 5 (left) / HIGH > 5 (right)'}
          </span>
          <span className="font-mono text-[5rem] leading-none text-ink">{String(d.digit)}</span>
        </div>
      );
    }
    case 'REASONING':
      return (
        <span className="font-mono text-heading text-ink">
          {(d.terms as number[]).join(', ')}, ?
        </span>
      );
    default:
      return null;
  }
}

function SymbolKey() {
  return (
    <div
      className="grid grid-cols-9 gap-1 rounded-md border p-2 text-center"
      aria-label="Symbol key"
    >
      {Object.entries(SYMBOL_KEY).map(([symbol, digit]) => (
        <div key={symbol} className="w-8">
          <div className="text-title text-ink">{symbol}</div>
          <div className="text-caption text-ink-muted">{digit}</div>
        </div>
      ))}
    </div>
  );
}

export function StimulusView({
  protocolId,
  state,
  theme,
  title,
  onStagePointer,
}: {
  protocolId: string;
  state: EngineState;
  theme: Theme;
  title: string;
  /** PVT accepts a tap anywhere on the stage. */
  onStagePointer?: (device: InputDevice) => void;
}) {
  const onPointerDown = (e: PointerEvent) =>
    onStagePointer?.((e.pointerType || 'mouse') as InputDevice);
  return (
    <div
      data-testid="stimulus-stage"
      data-status={state.status}
      onPointerDown={onStagePointer ? onPointerDown : undefined}
      className={cn(
        'relative flex min-h-[16rem] select-none items-center justify-center rounded-lg border p-6',
        theme === 'mission'
          ? 'border-accent/40 bg-[radial-gradient(circle_at_50%_40%,#13213b,#050a14)] shadow-[inset_0_0_40px_rgba(34,195,221,0.12)]'
          : 'bg-surface-sunken',
      )}
    >
      {theme === 'mission' && (
        <span className="absolute left-3 top-2 font-mono text-caption uppercase tracking-widest text-accent-strong">
          {title} · console
        </span>
      )}
      <Content protocolId={protocolId} state={state} />
    </div>
  );
}
