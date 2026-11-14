import {
  Activity,
  AudioWaveform,
  Droplets,
  Footprints,
  Gauge,
  HeartPulse,
  Moon,
  Radiation,
  Thermometer,
  Wind,
  type LucideIcon,
} from 'lucide-react';
import type { HealthMeasure } from '@/api/types';
import { DataState, PageHeader } from '@/components/shared';
import { formatNumber, formatUnit } from '@/lib/format';
import { statusOf } from '@/lib/queryState';
import { cn } from '@/lib/utils';
import { MEASURE_ORDER, MEASURES } from './config';
import { useAstronautContext, useHealthSummary } from './hooks';

const ICONS: Record<HealthMeasure, { icon: LucideIcon; tone: string }> = {
  heart_rate: { icon: HeartPulse, tone: 'text-rose-300 bg-rose-400/10' },
  hrv_rmssd: { icon: AudioWaveform, tone: 'text-cyan-300 bg-cyan-400/10' },
  spo2: { icon: Droplets, tone: 'text-sky-300 bg-sky-400/10' },
  blood_pressure: { icon: Gauge, tone: 'text-indigo-300 bg-indigo-400/10' },
  respiratory_rate: { icon: Wind, tone: 'text-teal-300 bg-teal-400/10' },
  body_temperature: { icon: Thermometer, tone: 'text-amber-300 bg-amber-400/10' },
  sleep_duration: { icon: Moon, tone: 'text-violet-300 bg-violet-400/10' },
  radiation_dose_rate: { icon: Radiation, tone: 'text-yellow-200 bg-yellow-300/10' },
  physical_activity: { icon: Footprints, tone: 'text-emerald-300 bg-emerald-400/10' },
};

/**
 * Card shows only icon, name, value and unit. Provenance, quality and timestamps stay
 * in the data (they feed the readiness estimate and the detailed trend charts).
 */
function VitalCard({
  measure,
  value,
  unit,
}: {
  measure: HealthMeasure;
  value: number | null | undefined;
  unit: string | null | undefined;
}) {
  const meta = MEASURES[measure];
  const { icon: Icon, tone } = ICONS[measure];
  const hasValue = typeof value === 'number' && Number.isFinite(value);
  const u = formatUnit(unit);
  const id = `vital-${measure}`;
  return (
    <article
      aria-labelledby={id}
      data-testid="vital-card"
      data-measure={measure}
      className="surface-glass hover-lift group flex flex-col gap-5 p-5"
    >
      <div className="flex items-center gap-3">
        <span className={cn('flex h-11 w-11 items-center justify-center rounded-xl', tone)}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <h2 id={id} className="text-label font-medium uppercase text-ink-muted">
          {meta.label}
        </h2>
      </div>
      <p className="flex items-baseline gap-2">
        {hasValue ? (
          <>
            <span className="text-metric text-ink">{formatNumber(value, meta.fractionDigits)}</span>
            {u && <span className="text-body text-ink-muted">{u}</span>}
          </>
        ) : (
          <>
            <span className="text-metric text-ink-subtle" aria-hidden="true">
              —
            </span>
            <span className="sr-only">No data</span>
          </>
        )}
      </p>
    </article>
  );
}

export function CurrentVitalsPage() {
  const { astronautId } = useAstronautContext();
  const summary = useHealthSummary(astronautId);
  const measurements = summary.data?.measurements ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Current Vitals"
        description="Your latest value for each measure, up to the current mission clock."
        actions={<Activity className="h-5 w-5 text-accent" aria-hidden="true" />}
      />
      <DataState
        status={statusOf(summary, measurements.length === 0)}
        error={summary.error}
        onRetry={() => void summary.refetch()}
        emptyMessage="No measurements have been recorded yet."
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {MEASURE_ORDER.map((measure) => {
            const m = measurements.find((x) => x.measure === measure);
            return <VitalCard key={measure} measure={measure} value={m?.value} unit={m?.unit} />;
          })}
        </div>
      </DataState>
    </div>
  );
}
