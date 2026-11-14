import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { HealthMeasure } from '@/api/types';
import { DataState, StatusBadge } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { COGNITIVE_DOMAINS, MEASURES, shiftDate } from '@/features/health/config';
import {
  useActivity,
  useAstronautContext,
  useComparisons,
  useHealthSummary,
  useRadiation,
} from '@/features/health/hooks';
import { formatDate, formatNumber, formatTimestamp, formatUnit, humanise } from '@/lib/format';
import { statusOf } from '@/lib/queryState';
import { useSensors } from './hooks';
import type { OverlayModel } from './overlay';
import { regionById, type RegionId } from './regions';

function Tag({ kind }: { kind: 'measured' | 'estimated' }) {
  return kind === 'measured' ? (
    <span className="rounded border border-accent/40 px-1.5 py-0.5 text-caption text-accent-strong">
      Measured
    </span>
  ) : (
    <span className="rounded border border-status-review/50 px-1.5 py-0.5 text-caption text-status-review">
      Modelled estimate
    </span>
  );
}

function Row({
  label,
  value,
  meta,
  tag,
}: {
  label: string;
  value: ReactNode;
  meta?: string;
  tag?: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b py-2 last:border-0">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="flex items-center gap-2 text-sm text-ink">
        {value}
        {tag}
      </span>
      {meta && <span className="w-full text-caption text-ink-subtle">{meta}</span>}
    </li>
  );
}

const NoData = ({ children }: { children: string }) => (
  <span className="text-ink-subtle">{children}</span>
);

function MeasureRows({ measures }: { measures: HealthMeasure[] }) {
  const { astronautId } = useAstronautContext();
  const summary = useHealthSummary(astronautId);
  const rows = summary.data?.measurements ?? [];
  return (
    <DataState
      status={statusOf(summary, false)}
      error={summary.error}
      onRetry={() => void summary.refetch()}
    >
      <ul>
        {measures.map((measure) => {
          const m = rows.find((x) => x.measure === measure);
          const meta = MEASURES[measure];
          return (
            <Row
              key={measure}
              label={meta.label}
              value={
                m && m.value !== null ? (
                  `${formatNumber(m.value, meta.fractionDigits)} ${formatUnit(m.unit)}`
                ) : (
                  <NoData>No data</NoData>
                )
              }
              tag={m?.value !== null && m?.provenance ? <Tag kind={m.provenance} /> : undefined}
              meta={
                m?.value !== null && m
                  ? `${formatTimestamp(m.measured_at)} · ${m.source_type} · ${m.source_id}`
                  : undefined
              }
            />
          );
        })}
      </ul>
    </DataState>
  );
}

function ChestPanel() {
  const sensors = useSensors();
  const ecg = sensors.data?.find((s) => /ecg|electrocardio/i.test(s.sensor_name));
  return (
    <>
      <MeasureRows measures={['heart_rate', 'respiratory_rate', 'spo2']} />
      <ul>
        <Row
          label="ECG"
          value={
            sensors.isPending ? (
              'Loading…'
            ) : ecg ? (
              `Sensor ${ecg.sensor_id} configured`
            ) : (
              <NoData>No data: no ECG sensor is configured</NoData>
            )
          }
        />
      </ul>
    </>
  );
}

function HeadPanel() {
  const { astronautId, missionDate, missionTime } = useAstronautContext();
  const range = missionDate ? { from: shiftDate(missionDate, -7), to: missionDate } : null;
  const comparisons = useComparisons(astronautId, range);
  const views = (comparisons.data ?? []).filter(
    (v) => missionTime && v.comparison.calculated_at <= missionTime,
  );
  return (
    <>
      <DataState
        status={statusOf(comparisons, false)}
        error={comparisons.error}
        onRetry={() => void comparisons.refetch()}
      >
        <ul>
          {COGNITIVE_DOMAINS.map((d) => {
            const v = views
              .filter((x) => x.daily_result.cognitive_domain === d.key)
              .sort((a, b) =>
                b.comparison.calculated_at.localeCompare(a.comparison.calculated_at),
              )[0];
            return (
              <Row
                key={d.key}
                label={d.label}
                value={
                  v ? (
                    <>
                      {formatNumber(v.comparison.inflight_value, 1)}{' '}
                      {formatUnit(v.daily_result.metric_unit)}
                      <StatusBadge
                        status={
                          v.comparison.reference_range_status === 'within_reference'
                            ? 'nominal'
                            : 'review'
                        }
                        label={
                          v.comparison.reference_range_status === 'within_reference'
                            ? 'Within reference'
                            : 'Flagged for contextual review'
                        }
                      />
                    </>
                  ) : (
                    <NoData>No data</NoData>
                  )
                }
                meta={
                  v
                    ? `${formatDate(v.daily_result.assessment_date)} · ${humanise(v.daily_result.metric_name)}`
                    : undefined
                }
              />
            );
          })}
        </ul>
      </DataState>
      <Button asChild variant="link" className="h-auto p-0">
        <Link to="/astronaut/cognition/trends">
          View cognitive trends <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    </>
  );
}

function AbdomenPanel({ overlay }: { overlay: OverlayModel | null }) {
  const regional = overlay?.regions.abdomen;
  return (
    <ul>
      <Row
        label="Modelled organ dose"
        tag={<Tag kind="estimated" />}
        value={
          regional?.basis === 'regional' && regional.estimate ? (
            `${formatNumber(regional.estimate.estimated_dose, 4)} ${regional.estimate.dose_unit}`
          ) : (
            <NoData>No data: no modelled organ dose exists for this region</NoData>
          )
        }
        meta={
          regional?.basis === 'regional' && regional.estimate
            ? `${regional.estimate.organ_name} · ${regional.estimate.model_name} ${regional.estimate.model_version} · ${regional.estimate.uncertainty.replace(/_/g, ' ')}`
            : 'The whole-body estimate is under Whole body.'
        }
      />
    </ul>
  );
}

function ArmPanel() {
  return (
    <>
      <p className="text-caption text-ink-subtle">
        Sensor placement on the body is not recorded, so this lists every wearable reading.
      </p>
      <MeasureRows
        measures={['heart_rate', 'hrv_rmssd', 'spo2', 'respiratory_rate', 'body_temperature']}
      />
    </>
  );
}

function LegPanel() {
  const { astronautId, missionDate, missionTime } = useAstronautContext();
  const range =
    missionDate && missionTime
      ? { from: `${shiftDate(missionDate, -7)}T00:00:00Z`, to: missionTime }
      : null;
  const activity = useActivity(astronautId, range);
  const rows = [...(activity.data ?? [])].sort((a, b) => b.start_time.localeCompare(a.start_time));
  return (
    <DataState
      status={statusOf(activity, rows.length === 0, 'no-data')}
      error={activity.error}
      noDataMessage="No data: no movement or exercise recorded in the last 7 days."
    >
      <ul data-testid="activity-list">
        {rows.map((r) => (
          <Row
            key={r.activity_id}
            label={`${formatDate(r.start_time)} · ${humanise(r.activity_type)}`}
            value={`${r.duration_minutes} min`}
            tag={<Tag kind="measured" />}
            meta={`${humanise(r.physical_intensity)} intensity · average heart rate ${formatNumber(r.heart_rate_average, 0)} bpm · perceived exertion ${formatNumber(r.perceived_exertion, 1)}`}
          />
        ))}
      </ul>
    </DataState>
  );
}

function WholeBodyPanel({ overlay }: { overlay: OverlayModel | null }) {
  const { astronautId, missionTime, launch } = useAstronautContext();
  const range = missionTime && launch ? { from: launch, to: missionTime } : null;
  const radiation = useRadiation(astronautId, range);
  const latest = [...(radiation.data ?? [])].sort((a, b) =>
    b.timestamp_utc.localeCompare(a.timestamp_utc),
  )[0];
  const whole = overlay?.regions.whole_body.estimate;
  return (
    <DataState
      status={statusOf(radiation, false)}
      error={radiation.error}
      onRetry={() => void radiation.refetch()}
    >
      <h3 className="text-label font-medium text-ink">Personal dosimetry</h3>
      <ul>
        <Row
          label="Dose rate"
          value={
            latest ? (
              `${formatNumber(latest.dose_rate, 3)} ${latest.dose_rate_unit}`
            ) : (
              <NoData>No data</NoData>
            )
          }
          tag={latest ? <Tag kind="measured" /> : undefined}
          meta={
            latest
              ? `${formatTimestamp(latest.timestamp_utc)} · ${latest.detector_location}`
              : undefined
          }
        />
        <Row
          label="Accumulated exposure"
          value={
            latest?.accumulated_dose !== null && latest ? (
              `${formatNumber(latest.accumulated_dose, 4)} ${latest.accumulated_dose_unit ?? ''}`
            ) : (
              <NoData>No data</NoData>
            )
          }
          tag={latest?.accumulated_dose !== null && latest ? <Tag kind="measured" /> : undefined}
        />
      </ul>
      <h3 className="mt-3 text-label font-medium text-ink">Modelled whole-body dose</h3>
      <ul>
        <Row
          label="Estimated dose"
          value={
            whole ? (
              `${formatNumber(whole.estimated_dose, 4)} ${whole.dose_unit}`
            ) : (
              <NoData>No data</NoData>
            )
          }
          tag={whole ? <Tag kind="estimated" /> : undefined}
          meta={
            whole
              ? `${formatTimestamp(whole.timestamp_utc)} · ${whole.model_name} ${whole.model_version} · uncertainty: ${whole.uncertainty.replace(/_/g, ' ')}`
              : undefined
          }
        />
      </ul>
    </DataState>
  );
}

const PANEL_INTRO: Record<string, string> = {
  whole_body: 'Personal dosimetry and accumulated exposure.',
  head: 'Latest cognitive results, each against your preflight reference.',
  chest: 'Heart rate, respiratory rate, blood oxygen and ECG.',
  abdomen: 'Modelled organ dose, where an estimate exists.',
  arm: 'Wearable measurements.',
  leg: 'Movement and exercise in the last 7 days.',
};

export function RegionPanel({
  region,
  overlay,
}: {
  region: RegionId;
  overlay: OverlayModel | null;
}) {
  const meta = regionById(region);
  return (
    <Card className="space-y-3 p-5" role="region" aria-labelledby="region-panel-title">
      <div>
        <h2 id="region-panel-title" className="text-title">
          {meta.label}
        </h2>
        <p className="text-sm text-ink-muted">{PANEL_INTRO[meta.panel]}</p>
      </div>
      {meta.panel === 'whole_body' && <WholeBodyPanel overlay={overlay} />}
      {meta.panel === 'head' && <HeadPanel />}
      {meta.panel === 'chest' && <ChestPanel />}
      {meta.panel === 'abdomen' && <AbdomenPanel overlay={overlay} />}
      {meta.panel === 'arm' && <ArmPanel />}
      {meta.panel === 'leg' && <LegPanel />}
    </Card>
  );
}
