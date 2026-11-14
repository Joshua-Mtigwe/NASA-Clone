import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';

export interface QuestionnaireAnswers {
  fatigue_score: number;
  sleepiness_score: number;
  perceived_workload: number;
  sleep_quality_score: number;
  prior_sleep_hours: number;
  time_since_waking_minutes: number;
  preceding_activity: string;
}

const SCALES: Array<{ key: keyof QuestionnaireAnswers; label: string; low: string; high: string }> =
  [
    {
      key: 'fatigue_score',
      label: 'How fatigued do you feel?',
      low: '1 not at all',
      high: '9 extremely',
    },
    {
      key: 'sleepiness_score',
      label: 'How sleepy do you feel?',
      low: '1 extremely alert',
      high: '9 very sleepy',
    },
    {
      key: 'perceived_workload',
      label: 'How demanding has your workload been?',
      low: '1 very low',
      high: '9 very high',
    },
    {
      key: 'sleep_quality_score',
      label: 'How well did you sleep last night?',
      low: '1 very poorly',
      high: '9 very well',
    },
  ];

/** Subjective state check-in: fatigue, sleepiness, perceived workload, sleep quality. */
export function Questionnaire({
  onSubmit,
  submitting,
  error,
}: {
  onSubmit: (answers: QuestionnaireAnswers) => void;
  submitting: boolean;
  error: string | null;
}) {
  const id = useId();
  const [values, setValues] = useState<Partial<QuestionnaireAnswers>>({
    prior_sleep_hours: 7,
    time_since_waking_minutes: 120,
    preceding_activity: 'routine',
  });
  const missing = SCALES.filter((s) => values[s.key] === undefined);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (missing.length === 0) onSubmit(values as QuestionnaireAnswers);
  };

  return (
    <form onSubmit={submit} className="space-y-5" aria-label="Subjective state check-in">
      {SCALES.map((s) => (
        <fieldset key={s.key} className="space-y-2">
          <legend className="text-sm font-medium text-ink">{s.label}</legend>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => (
              <label key={n} className="cursor-pointer">
                <input
                  type="radio"
                  name={`${id}-${s.key}`}
                  value={n}
                  checked={values[s.key] === n}
                  onChange={() => setValues((v) => ({ ...v, [s.key]: n }))}
                  className="peer sr-only"
                  aria-label={`${s.label} ${n}`}
                />
                <span className="flex h-9 w-9 items-center justify-center rounded-md border text-sm text-ink-muted peer-checked:border-accent peer-checked:bg-accent-muted/60 peer-checked:text-ink peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                  {n}
                </span>
              </label>
            ))}
          </div>
          <p className="flex justify-between text-caption text-ink-subtle">
            <span>{s.low}</span>
            <span>{s.high}</span>
          </p>
        </fieldset>
      ))}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm text-ink-muted">
          Hours slept
          <input
            type="number"
            min={0}
            max={14}
            step={0.5}
            value={values.prior_sleep_hours ?? ''}
            onChange={(e) =>
              setValues((v) => ({ ...v, prior_sleep_hours: Number(e.target.value) }))
            }
            className="h-10 w-full rounded-md border bg-surface-sunken px-3 text-ink"
          />
        </label>
        <label className="space-y-1 text-sm text-ink-muted">
          Minutes since waking
          <input
            type="number"
            min={0}
            max={1440}
            value={values.time_since_waking_minutes ?? ''}
            onChange={(e) =>
              setValues((v) => ({ ...v, time_since_waking_minutes: Number(e.target.value) }))
            }
            className="h-10 w-full rounded-md border bg-surface-sunken px-3 text-ink"
          />
        </label>
        <label className="space-y-1 text-sm text-ink-muted">
          Just before this
          <select
            value={values.preceding_activity}
            onChange={(e) => setValues((v) => ({ ...v, preceding_activity: e.target.value }))}
            className="h-10 w-full rounded-md border bg-surface-sunken px-3 text-ink"
          >
            <option value="routine">Routine duties</option>
            <option value="physical_work">Physical work</option>
            <option value="mental_work">Mental work</option>
            <option value="rest">Rest</option>
          </select>
        </label>
      </div>

      {error && (
        <p role="alert" className="text-sm text-status-action">
          {error}
        </p>
      )}
      <Button type="submit" disabled={submitting || missing.length > 0}>
        {submitting ? 'Saving…' : 'Submit check-in'}
      </Button>
      {missing.length > 0 && (
        <p className="text-caption text-ink-subtle">Answer all four questions to continue.</p>
      )}
    </form>
  );
}
