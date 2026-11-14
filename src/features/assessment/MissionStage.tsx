import { lazy, Suspense, useState, type PointerEvent } from 'react';
import type { InputDevice } from '@/api/types';
import { hasWebGL, prefersReducedMotion } from '@/features/bodymap/capabilities';
import type { EngineState } from './engine/types';
import { StimulusView } from './StimulusView';

const PixiStage = lazy(() => import('./PixiStage'));

/** Pixi stages exist for the five Mission Mind games. */
const PIXI_GAMES = new Set(['PVT', 'NBACK', 'STROOP', 'ROTATION', 'SWITCH']);

/**
 * Mission Mind stage: PixiJS when WebGL is available and motion is allowed,
 * otherwise the DOM stage in the same theme. Both read the same engine state.
 */
export function MissionStage(props: {
  protocolId: string;
  state: EngineState;
  title: string;
  onStagePointer?: (device: InputDevice) => void;
}) {
  const [usePixi] = useState(
    () => PIXI_GAMES.has(props.protocolId) && hasWebGL() && !prefersReducedMotion(),
  );
  if (!usePixi) return <StimulusView {...props} theme="mission" />;

  const onPointerDown = (e: PointerEvent) =>
    props.onStagePointer?.((e.pointerType || 'mouse') as InputDevice);
  return (
    <div
      data-testid="stimulus-stage"
      data-status={props.state.status}
      onPointerDown={props.onStagePointer ? onPointerDown : undefined}
      className="select-none rounded-lg border border-accent/40"
    >
      <Suspense fallback={<StimulusView {...props} theme="mission" />}>
        <PixiStage protocolId={props.protocolId} state={props.state} title={props.title} />
      </Suspense>
    </div>
  );
}
