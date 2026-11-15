/**
 * One assessment session: instructions, practice (recorded separately), test,
 * completion. The server authorises the start; trials and the completion go to the
 * offline queue first. The completion screen shows the scores the backend returns,
 * one per assessment, and never an overall grade.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CloudOff, Pause, Trophy } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { assessmentsApi } from '@/api/assessments';
import type { AssessmentSessionsRow } from '@/types/tables';
import type { DueAssessment, InputDevice, TrialPhase } from '@/api/types';
import { StatusBadge } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { browserClock } from './engine/engine';
import type { EngineTrialRecord } from './engine/types';
import {
  buildSchedule,
  CONDITION_LABELS,
  MISSION_MIND_GAMES,
  TEST_DEFINITIONS,
} from './battery/registry';
import { MissionStage } from './MissionStage';
import {
  enqueueCompletion,
  enqueueContext,
  enqueueTrials,
  flushQueue,
  useCompletion,
  useOutboxStatus,
} from './offline/queue';
import { Questionnaire, type QuestionnaireAnswers } from './Questionnaire';
import { ResponsePad } from './ResponsePad';
import { describeResult } from './results';
import { StimulusView, type Theme } from './StimulusView';
import { useTrialEngine, type EngineDeps } from './useTrialEngine';

type Step =
  'instructions' | 'practice' | 'practice_done' | 'test' | 'questionnaire' | 'saving' | 'done';

export interface AssessmentRunnerProps {
  due: DueAssessment;
  theme: Theme;
  deps?: EngineDeps;
  /** Test-only: shorter phases. Never set by app code. */
  trialCounts?: { practice: number; test: number };
  onExit?: () => void;
}

function deviceOf(records: EngineTrialRecord[]): InputDevice | 'mixed' | null {
  const devices = new Set(records.map((r) => r.input_device).filter(Boolean));
  if (devices.size === 0) return null;
  return devices.size === 1 ? ([...devices][0] as InputDevice) : 'mixed';
}

const toTrialInput = ({
  phase: _p,
  input_device: _d,
  test_version: _v,
  onset_ms: _o,
  ...trial
}: EngineTrialRecord) => trial;

export function AssessmentRunner({ due, theme, deps, trialCounts, onExit }: AssessmentRunnerProps) {
  const queryClient = useQueryClient();
  const protocolId = due.protocol.protocol_id;
  const definition = TEST_DEFINITIONS[protocolId] ?? null;
  const isSurvey = !definition;
  const game = theme === 'mission' ? MISSION_MIND_GAMES[protocolId] : undefined;
  const title = game?.name ?? definition?.title ?? due.protocol.protocol_name;
  const clock = deps?.clock ?? browserClock;

  const [step, setStep] = useState<Step>('instructions');
  const [session, setSession] = useState<AssessmentSessionsRow | null>(null);
  const [surveyError, setSurveyError] = useState<string | null>(null);
  const startPerf = useRef(0);
  const interruptions = useRef(0);

  const start = useMutation({
    // Fail fast with a network error offline instead of pausing silently.
    networkMode: 'always',
    mutationFn: () => assessmentsApi.startSession({ assignment_id: due.assignment.assignment_id }),
    onSuccess: (s) => {
      setSession(s);
      startPerf.current = clock.now();
      setStep(isSurvey ? 'questionnaire' : 'practice');
    },
  });

  const seed = `${due.assignment.assignment_id}|${session?.session_id ?? ''}`;
  const specs = useMemo(() => {
    if (!definition || !session) return { practice: [], test: [] };
    return {
      practice: buildSchedule(definition, seed, 'practice', trialCounts?.practice),
      test: buildSchedule(definition, seed, 'test', trialCounts?.test),
    };
  }, [definition, session, seed, trialCounts?.practice, trialCounts?.test]);

  const completedAt = useCallback(() => {
    const base = Date.parse(session!.started_at);
    return new Date(base + (clock.now() - startPerf.current))
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z');
  }, [clock, session]);

  const finishPhase = useCallback(
    async (phase: TrialPhase, records: EngineTrialRecord[], count: number) => {
      if (!session || !definition) return;
      interruptions.current += count;
      await enqueueTrials(session.session_id, {
        trials: records.map(toTrialInput),
        phase,
        input_device: deviceOf(records),
        test_version: definition.testVersion,
      });
      if (phase === 'practice') {
        setStep('practice_done');
        void flushQueue().catch(() => undefined);
        return;
      }
      setStep('saving');
      await enqueueCompletion(session.session_id, {
        completed_at: completedAt(),
        interruption_count: interruptions.current,
      });
      await flushQueue().catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: ['assessments'] });
      setStep('done');
    },
    [session, definition, completedAt, queryClient],
  );

  const running: TrialPhase | null =
    step === 'practice' ? 'practice' : step === 'test' ? 'test' : null;
  const engine = useTrialEngine({
    active: running !== null,
    definition,
    specs: running === 'practice' ? specs.practice : specs.test,
    phase: running ?? 'test',
    baseTimestamp: session?.started_at ?? null,
    deps,
    onFinish: (records, count) => void finishPhase(running ?? 'test', records, count),
  });

  // Keyboard responses, and pausing when the tab is hidden or focus is lost.
  useEffect(() => {
    if (!running || !definition) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const spec = engine.state.spec;
      const options =
        spec && definition.responsesFor ? definition.responsesFor(spec) : definition.responses;
      const option = options.find((o) => o.keys.includes(e.key));
      if (!option) return;
      e.preventDefault();
      engine.respond(option.value, 'keyboard');
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') engine.interrupt();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', engine.interrupt);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', engine.interrupt);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [running, definition, engine]);

  const submitSurvey = async (answers: QuestionnaireAnswers) => {
    if (!session) return;
    setSurveyError(null);
    setStep('saving');
    // Check-in first, then the completion: both queue offline and flush in order.
    try {
      await enqueueContext(session.session_id, {
        astronaut_id: session.astronaut_id,
        mission_id: session.mission_id,
        timestamp_utc: session.started_at,
        circadian_condition: session.assessment_condition,
        source_type: 'self_report',
        ...answers,
      });
    } catch (error) {
      setSurveyError(error instanceof Error ? error.message : 'Could not save the check-in.');
      setStep('questionnaire');
      return;
    }
    await enqueueCompletion(session.session_id, {
      completed_at: completedAt(),
      interruption_count: 0,
    });
    await flushQueue().catch(() => undefined);
    void queryClient.invalidateQueries({ queryKey: ['assessments'] });
    setStep('done');
  };

  const completion = useCompletion(session?.session_id ?? null);
  const outbox = useOutboxStatus();
  const spec = engine.state.spec;
  const options = definition
    ? spec && definition.responsesFor
      ? definition.responsesFor(spec)
      : definition.responses
    : [];
  const stageProps = {
    protocolId,
    state: engine.state,
    title,
    onStagePointer:
      protocolId === 'PVT' ? (d: InputDevice) => engine.respond('click', d) : undefined,
  };

  return (
    <Card
      className={cn(
        'space-y-5 p-5',
        theme === 'mission' &&
          'border-accent/30 bg-gradient-to-b from-navy-850 to-navy-950 shadow-glow',
      )}
      role="region"
      aria-label={`${title} session`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-title">{title}</h2>
        <span className="rounded border px-2 py-0.5 text-caption text-ink-muted">
          {CONDITION_LABELS[due.assignment.assessment_condition] ??
            due.assignment.assessment_condition}
        </span>
        {game && <span className="text-caption text-ink-subtle">{game.skill}</span>}
      </div>

      {step === 'instructions' && (
        <div className="space-y-4">
          <ul className="list-disc space-y-1 pl-5 text-ink-muted">
            {(
              definition?.instructions ?? [
                'Answer four short questions about how you feel right now.',
              ]
            ).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {definition && (
            <p className="text-sm text-ink-subtle">
              {definition.practiceTrials} practice trials (not scored), then {definition.testTrials}{' '}
              test trials.
            </p>
          )}
          {start.isError && (
            <p role="alert" className="text-sm text-status-action">
              {start.error.message}
            </p>
          )}
          <div className="flex gap-2">
            <Button onClick={() => start.mutate()} disabled={start.isPending}>
              {start.isPending ? 'Starting…' : isSurvey ? 'Start check-in' : 'Start practice'}
            </Button>
            {onExit && (
              <Button variant="outline" onClick={onExit}>
                Back
              </Button>
            )}
          </div>
        </div>
      )}

      {(step === 'practice' || step === 'test') && (
        <div className="space-y-4">
          <p className="text-label text-ink-muted" aria-live="polite">
            {step === 'practice' ? 'Practice' : 'Test'} · trial{' '}
            {Math.min(engine.state.index + 1, engine.state.total)} of {engine.state.total}
          </p>
          <div className="relative">
            {theme === 'mission' ? (
              <MissionStage {...stageProps} />
            ) : (
              <StimulusView {...stageProps} theme="standard" />
            )}
            {engine.state.status === 'interrupted' && (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg bg-navy-950/90"
                role="alertdialog"
                aria-label="Paused"
              >
                <Pause className="h-6 w-6 text-status-review" aria-hidden="true" />
                <p className="text-ink">
                  Paused: the window lost focus. The interrupted trial will be repeated.
                </p>
                <Button onClick={engine.resume}>Resume</Button>
              </div>
            )}
          </div>
          <ResponsePad options={options} onRespond={engine.respond} />
        </div>
      )}

      {step === 'practice_done' && (
        <div className="space-y-3">
          <p className="text-ink">
            Practice complete. Practice trials are recorded separately and not scored.
          </p>
          <Button onClick={() => setStep('test')}>Start test</Button>
        </div>
      )}

      {step === 'questionnaire' && (
        <Questionnaire
          onSubmit={(a) => void submitSurvey(a)}
          submitting={false}
          error={surveyError}
        />
      )}

      {step === 'saving' && (
        <p role="status" className="text-ink-muted">
          Saving on this device and sending…
        </p>
      )}

      {step === 'done' && (
        <div
          className="space-y-3 rounded-xl border border-status-nominal/30 bg-gradient-to-br from-emerald-950/40 to-navy-900 p-5 motion-safe:animate-fade-up"
          data-testid="completion"
        >
          <h3 className="flex items-center gap-2 text-label font-medium text-ink">
            <Trophy className="h-5 w-5 text-amber-300" aria-hidden="true" />
            Session complete
          </h3>
          {completion ? (
            <>
              <ul className="space-y-1">
                {completion.completion.results.map((r) => {
                  const d = describeResult(r);
                  return (
                    <li key={r.result_id} className="flex flex-wrap items-baseline gap-2">
                      <span className="text-ink-muted">{d.label}</span>
                      <span className="text-metric-sm text-ink">{d.value}</span>
                    </li>
                  );
                })}
              </ul>
              {completion.completion.results.length === 0 && (
                <p className="text-ink-muted">No score was returned for this session.</p>
              )}
              <p className="text-caption text-ink-subtle">
                Scored by the mission server (
                {completion.completion.session.quality_status.replace(/_/g, ' ')}).
              </p>
            </>
          ) : (
            <div className="flex items-start gap-2 text-ink-muted" role="status">
              <CloudOff className="mt-0.5 h-4 w-4 text-status-review" aria-hidden="true" />
              <p>
                Saved on this device. Your score appears once the session syncs.
                {outbox.pending > 0 && ` ${outbox.pending} item(s) waiting to sync.`}
              </p>
            </div>
          )}
          {outbox.failed.length > 0 && (
            <StatusBadge status="action" label="Some data could not be synced" />
          )}
          {onExit && (
            <Button variant="outline" onClick={onExit}>
              Done
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
