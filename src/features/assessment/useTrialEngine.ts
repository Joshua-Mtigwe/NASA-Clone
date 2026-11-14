import { useCallback, useEffect, useRef, useState } from 'react';
import type { InputDevice, TrialPhase } from '@/api/types';
import { createTrialEngine, type TrialEngine } from './engine/engine';
import type {
  Clock,
  EngineState,
  EngineTrialRecord,
  TestDefinition,
  Timers,
  TrialSpec,
} from './engine/types';

export interface EngineDeps {
  clock?: Clock;
  timers?: Timers;
}

const IDLE: EngineState = {
  status: 'idle',
  index: 0,
  total: 0,
  spec: null,
  stimulusVisible: false,
  interruptions: 0,
};

/** React binding for one engine run (one phase). Starts when `active` becomes true. */
export function useTrialEngine(args: {
  active: boolean;
  definition: TestDefinition | null;
  specs: TrialSpec[];
  phase: TrialPhase;
  baseTimestamp: string | null;
  deps?: EngineDeps;
  onFinish: (records: EngineTrialRecord[], interruptions: number) => void;
}) {
  const { active, definition, specs, phase, baseTimestamp, deps } = args;
  const [state, setState] = useState<EngineState>(IDLE);
  const engineRef = useRef<TrialEngine | null>(null);
  const finishRef = useRef(args.onFinish);
  finishRef.current = args.onFinish;

  useEffect(() => {
    if (!active || !definition || !baseTimestamp) return;
    const engine = createTrialEngine({
      definition,
      phase,
      specs,
      baseTimestamp,
      clock: deps?.clock,
      timers: deps?.timers,
      onChange: setState,
      onFinish: (records, interruptions) => finishRef.current(records, interruptions),
    });
    engineRef.current = engine;
    engine.start();
    return () => {
      engine.stop();
      engineRef.current = null;
    };
    // specs/deps are fixed for a run; restarting only when the phase changes.
  }, [active, definition, phase, baseTimestamp]); // eslint-disable-line react-hooks/exhaustive-deps

  const respond = useCallback((value: string, device: InputDevice) => {
    engineRef.current?.respond(value, device);
  }, []);
  const interrupt = useCallback(() => engineRef.current?.interrupt(), []);
  const resume = useCallback(() => engineRef.current?.resume(), []);

  return { state, respond, interrupt, resume };
}
