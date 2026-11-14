import { useState } from 'react';
import { DailyBarChart } from '@/components/charts/DailyBarChart';
import { TimeSeriesChart, type TimePoint } from '@/components/charts/TimeSeriesChart';
import { ChartFrame, DataState, PageHeader } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { formatMinutes, formatNumber, formatUnit, humanise } from '@/lib/format';
import { statusOf } from '@/lib/queryState';
import {
  MEASURES,
  rangeBounds,
  SENSOR_SERIES,
  TIME_RANGES,
  type SensorSeries,
  type TimeRange,
} from './config';
import {
  useActivity,
  useAstronautContext,
  useRadiation,
  useSleep,
  useVitalsHistory,
  useVitalsReference,
} from './hooks';
import { SleepTimeline } from './SleepTimeline';

const toPoint = (iso: string, value: number): TimePoint => ({ t: Date.parse(iso), value, iso });

type Range = { from: string; to: string } | null;

function SensorChart({
  astronautId,
  type,
  range,
}: {
  astronautId: string | null;
  type: SensorSeries;
  range: Range;
}) {
  const history = useVitalsHistory(astronautId, type, range);
  const reference = useVitalsReference(astronautId, type);
  const rows = history.data?.items ?? [];
  const unit = rows[0]?.measurement_unit ?? null;
  const meta = MEASURES[type];
  const isHrv = type === 'hrv_rmssd';
  const ref = isHrv ? reference.data : null;
  const u = formatUnit(ref?.metric_unit ?? unit);

  let uncertainty: string | null = null;
  if (isHrv) {
    uncertainty = reference.isPending
      ? 'Loading personal reference…'
      : ref
        ? `Personal reference ${formatNumber(ref.reference_lower, 1)}–${formatNumber(ref.reference_upper, 1)} ${u} (n = ${ref.sample_size}, method: ${ref.reference_method})`
        : 'No personal reference available yet.';
  }

  return (
    <ChartFrame
      title={meta.label}
      unit={u || null}
      source={`sensor_readings · ${rows[0]?.source_type ?? 'source not reported'} · Measured`}
      sampleSize={history.data?.total ?? null}
      uncertainty={uncertainty}
      description={isHrv ? 'Shaded band: your personal reference from the backend.' : undefined}
    >
      <DataState
        status={statusOf(history, rows.length === 0, 'no-data')}
        error={history.error}
        onRetry={() => void history.refetch()}
        noDataMessage="No data in this range."
      >
        <TimeSeriesChart
          label={meta.label}
          unit={unit}
          fractionDigits={meta.fractionDigits === 0 ? 1 : meta.fractionDigits}
          data={rows.map((r) => toPoint(r.timestamp_utc, r.measurement_value))}
          reference={ref ? { lower: ref.reference_lower, upper: ref.reference_upper } : null}
        />
      </DataState>
    </ChartFrame>
  );
}

export function HealthMonitoringPage() {
  const { astronautId, missionTime, launch } = useAstronautContext();
  const [range, setRange] = useState<TimeRange>('7d');
  const bounds = missionTime && launch ? rangeBounds(range, missionTime, launch) : null;

  const sleep = useSleep(astronautId, bounds);
  const radiation = useRadiation(astronautId, bounds);
  const activity = useActivity(astronautId, bounds);
  const sleepRows = sleep.data ?? [];
  const radRows = radiation.data ?? [];
  const activityRows = activity.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Health Monitoring"
        description="Each measure over time, up to the current mission clock."
        actions={
          <div
            role="group"
            aria-label="Time range"
            className="flex flex-wrap gap-1 rounded-md border p-1"
          >
            {TIME_RANGES.map((r) => (
              <Button
                key={r.key}
                size="sm"
                variant={r.key === range ? 'default' : 'ghost'}
                aria-pressed={r.key === range}
                onClick={() => setRange(r.key)}
              >
                {r.label}
              </Button>
            ))}
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-2">
        {SENSOR_SERIES.map((type) => (
          <SensorChart key={type} astronautId={astronautId} type={type} range={bounds} />
        ))}
        <ChartFrame
          title="Blood pressure"
          unit="mmHg"
          source="No blood pressure sensor configured"
          sampleSize={null}
        >
          <DataState
            status="no-data"
            noDataMessage="No data: no blood pressure readings are recorded."
          />
        </ChartFrame>
      </div>

      <section aria-labelledby="sleep-title" className="space-y-3">
        <h2 id="sleep-title" className="text-title">
          Sleep
        </h2>
        <div className="grid gap-4 xl:grid-cols-2">
          <ChartFrame
            title="Sleep duration per night"
            unit="min"
            source={`sleep_records · ${sleepRows[0]?.data_source ?? 'source not reported'} · Measured`}
            sampleSize={sleep.data ? sleepRows.length : null}
          >
            <DataState
              status={statusOf(sleep, sleepRows.length === 0, 'no-data')}
              error={sleep.error}
              noDataMessage="No data in this range."
            >
              <DailyBarChart
                label="Sleep duration"
                unit="min"
                formatValue={formatMinutes}
                data={sleepRows.map((r) => ({
                  date: r.sleep_end.slice(0, 10),
                  value: r.total_sleep_minutes,
                }))}
              />
            </DataState>
          </ChartFrame>
          <ChartFrame
            title="Sleep timeline"
            unit="UTC clock time"
            source="sleep_records · Measured"
            sampleSize={sleep.data ? sleepRows.length : null}
          >
            <DataState
              status={statusOf(sleep, sleepRows.length === 0, 'no-data')}
              error={sleep.error}
              noDataMessage="No data in this range."
            >
              <SleepTimeline records={sleepRows} />
            </DataState>
          </ChartFrame>
        </div>
      </section>

      <section aria-labelledby="radiation-title" className="space-y-3">
        <h2 id="radiation-title" className="text-title">
          Radiation
        </h2>
        <p className="text-sm text-ink-muted">
          Dose rate and accumulated dose are separate variables and are shown in separate charts.
        </p>
        <div className="grid gap-4 xl:grid-cols-2">
          <ChartFrame
            title="Radiation dose rate"
            unit={radRows[0]?.dose_rate_unit ?? null}
            source={`radiation_readings · personal dosimeter · ${radRows[0]?.source_type ?? 'source not reported'} · Measured`}
            sampleSize={radiation.data ? radRows.length : null}
          >
            <DataState
              status={statusOf(radiation, radRows.length === 0, 'no-data')}
              error={radiation.error}
              noDataMessage="No data in this range."
            >
              <TimeSeriesChart
                label="Radiation dose rate"
                unit={radRows[0]?.dose_rate_unit ?? null}
                fractionDigits={3}
                data={radRows.map((r) => toPoint(r.timestamp_utc, r.dose_rate))}
              />
            </DataState>
          </ChartFrame>
          <ChartFrame
            title="Accumulated dose"
            unit={radRows.find((r) => r.accumulated_dose_unit)?.accumulated_dose_unit ?? null}
            source="radiation_readings · personal dosimeter · Measured"
            sampleSize={
              radiation.data ? radRows.filter((r) => r.accumulated_dose !== null).length : null
            }
          >
            <DataState
              status={statusOf(
                radiation,
                !radRows.some((r) => r.accumulated_dose !== null),
                'no-data',
              )}
              error={radiation.error}
              noDataMessage="No data in this range."
            >
              <TimeSeriesChart
                label="Accumulated dose"
                unit={radRows.find((r) => r.accumulated_dose_unit)?.accumulated_dose_unit ?? null}
                fractionDigits={4}
                data={radRows.flatMap((r) =>
                  r.accumulated_dose === null ? [] : [toPoint(r.timestamp_utc, r.accumulated_dose)],
                )}
              />
            </DataState>
          </ChartFrame>
        </div>
      </section>

      <section aria-labelledby="activity-title" className="space-y-3">
        <h2 id="activity-title" className="text-title">
          Physical activity
        </h2>
        <ChartFrame
          title="Activity duration per day"
          unit="min"
          source={`activity_records · ${humanise(activityRows[0]?.activity_type) || 'source not reported'} · Measured`}
          sampleSize={activity.data ? activityRows.length : null}
        >
          <DataState
            status={statusOf(activity, activityRows.length === 0, 'no-data')}
            error={activity.error}
            noDataMessage="No data in this range."
          >
            <DailyBarChart
              label="Activity duration"
              unit="min"
              data={activityRows.map((r) => ({
                date: r.start_time.slice(0, 10),
                value: r.duration_minutes,
              }))}
            />
          </DataState>
        </ChartFrame>
      </section>
    </div>
  );
}
