/**
 * Task Readiness estimate: a deterministic, explainable PROTOTYPE composite.
 *
 * Method (see config.ts for every weight and threshold):
 * 1. Each factor gets a contribution in [0, 1]:
 *    - with a personal reference range [L, U] from the backend: 1 inside the range;
 *      on the unfavourable side it starts at `outsideCeiling` and falls linearly to 0
 *      one range-width beyond the bound; on the favourable side it stays 1;
 *    - with a demonstration band (sleep measures without a reference): linear
 *      between `poor` (0) and `good` (1).
 * 2. A factor is used only if it has a value, passed quality checks and is not
 *    stale. Missing, stale, invalid and unreferenced factors are never counted as
 *    healthy: they are left out of the average and lower the data coverage.
 * 3. Category score = weighted mean of its used factors. Overall score = category
 *    weights renormalised over the categories that have data.
 * 4. No percentage is produced when coverage < minCoverage or fewer than
 *    minCategories categories have data.
 *
 * The result is an estimate for planning context. It is not medical clearance and
 * does not change the separate operational eligibility decided by the backend.
 */
import type {
  CognitiveComparisonView,
  HealthSummary,
  ReadinessFactor,
  ReadinessSummary,
} from '@/api/types';
import type { SleepRecordsRow } from '@/types/tables';
import {
  DEFAULT_READINESS_CONFIG,
  directionForMetric,
  type AbsoluteBand,
  type Direction,
  type FactorConfig,
  type ReadinessCategory,
  type ReadinessConfig,
} from './config';

export interface ReadinessInput {
  /** Mission clock. Nothing after it is used. */
  asOf: string;
  summary: ReadinessSummary | null;
  health: HealthSummary | null;
  /** Sleep records up to the mission clock (any order). */
  sleep: SleepRecordsRow[];
  /** Recent cognitive comparisons, used for metric direction and result quality. */
  comparisons: CognitiveComparisonView[];
}

export type FactorState =
  | 'scored'
  /** No value recorded. */
  | 'missing'
  /** Value older than the factor's maxAgeHours. */
  | 'stale'
  /** Value failed quality checks. */
  | 'invalid'
  /** Value exists but there is no reference to compare it with. */
  | 'no_reference';

export type Deviation = 'within' | 'unfavourable' | 'favourable' | 'band';

export interface FactorResult {
  key: string;
  label: string;
  category: ReadinessCategory;
  state: FactorState;
  required: boolean;
  weight: number;
  value: number | null;
  unit: string | null;
  measuredAt: string | null;
  referenceLower: number | null;
  referenceUpper: number | null;
  /** How the value sits against its reference; null unless scored. */
  deviation: Deviation | null;
  /** Backend flag for cognitive results outside the personal baseline. */
  flaggedForReview: boolean;
  /** Contribution in [0, 1]; null unless scored. */
  contribution: number | null;
  /** Distance beyond the reference bound in range-widths (0 inside). */
  distance: number | null;
}

export interface CategoryResult {
  category: ReadinessCategory;
  weight: number;
  /** Weighted mean contribution in [0, 1]; null when no factor was used. */
  score: number | null;
  /** Share of required weight that was usable, 0–1. */
  coverage: number;
  factors: FactorResult[];
}

export interface TaskReadiness {
  status: 'estimated' | 'insufficient_data';
  /** Whole percent 0–100; null when insufficient. */
  score: number | null;
  /** Overall data coverage 0–1. */
  coverage: number;
  confidence: 'high' | 'moderate' | 'low';
  asOf: string;
  categories: CategoryResult[];
  factors: FactorResult[];
}

const HOUR = 3_600_000;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function ageHours(asOf: string, at: string | null): number | null {
  if (!at) return null;
  return (Date.parse(asOf) - Date.parse(at)) / HOUR;
}

/** Contribution and deviation of a value against a personal reference range. */
export function referenceContribution(
  value: number,
  lower: number,
  upper: number,
  direction: Direction,
  ceiling: number,
): { contribution: number; deviation: Deviation; distance: number } {
  const width = Math.max(upper - lower, Math.abs(upper) * 1e-6, 1e-9);
  if (value >= lower && value <= upper)
    return { contribution: 1, deviation: 'within', distance: 0 };
  const below = value < lower;
  const distance = (below ? lower - value : value - upper) / width;
  const favourable =
    (below && direction === 'lower_is_better') || (!below && direction === 'higher_is_better');
  if (favourable) return { contribution: 1, deviation: 'favourable', distance };
  return {
    contribution: clamp01(ceiling * (1 - distance)),
    deviation: 'unfavourable',
    distance,
  };
}

/** Contribution of a value on a demonstration band (works for either direction). */
export function bandContribution(value: number, band: AbsoluteBand): number {
  if (band.good === band.poor) return value === band.good ? 1 : 0;
  return clamp01((value - band.poor) / (band.good - band.poor));
}

function blank(cfg: FactorConfig): FactorResult {
  return {
    key: cfg.key,
    label: cfg.label,
    category: cfg.category,
    state: 'missing',
    required: cfg.required,
    weight: cfg.weight,
    value: null,
    unit: null,
    measuredAt: null,
    referenceLower: null,
    referenceUpper: null,
    deviation: null,
    flaggedForReview: false,
    contribution: null,
    distance: null,
  };
}

function latestSleep(rows: SleepRecordsRow[], asOf: string): SleepRecordsRow | null {
  let best: SleepRecordsRow | null = null;
  for (const r of rows) {
    if (r.sleep_end > asOf) continue;
    if (!best || r.sleep_end > best.sleep_end) best = r;
  }
  return best;
}

function referencedFactor(
  cfg: FactorConfig,
  f: ReadinessFactor | undefined,
  input: ReadinessInput,
  config: ReadinessConfig,
  opts: { quality?: string | null; direction?: Direction; flagged?: boolean } = {},
): FactorResult {
  const out = blank(cfg);
  if (!f || f.value === null || f.measured_at === null) return out;
  out.value = f.value;
  out.unit = f.unit;
  out.measuredAt = f.measured_at;
  out.referenceLower = f.reference_lower;
  out.referenceUpper = f.reference_upper;
  out.flaggedForReview = !!opts.flagged;
  const age = ageHours(input.asOf, f.measured_at);
  if (age === null || age < 0 || age > cfg.maxAgeHours) return { ...out, state: 'stale' };
  if (opts.quality && opts.quality !== 'valid') return { ...out, state: 'invalid' };
  if (f.reference_lower === null || f.reference_upper === null) {
    return { ...out, state: 'no_reference' };
  }
  const r = referenceContribution(
    f.value,
    f.reference_lower,
    f.reference_upper,
    opts.direction ?? cfg.direction,
    config.outsideCeiling,
  );
  return { ...out, state: 'scored', ...r };
}

function sleepBandFactor(
  cfg: FactorConfig,
  night: SleepRecordsRow | null,
  value: (n: SleepRecordsRow) => number,
  band: AbsoluteBand,
  unit: string | null,
  input: ReadinessInput,
): FactorResult {
  const out = blank(cfg);
  if (!night) return out;
  out.value = value(night);
  out.unit = unit;
  out.measuredAt = night.sleep_end;
  const age = ageHours(input.asOf, night.sleep_end);
  if (age === null || age < 0 || age > cfg.maxAgeHours) return { ...out, state: 'stale' };
  if (night.quality_status !== 'valid') return { ...out, state: 'invalid' };
  return {
    ...out,
    state: 'scored',
    deviation: 'band',
    contribution: bandContribution(out.value, band),
  };
}

export function computeTaskReadiness(
  input: ReadinessInput,
  config: ReadinessConfig = DEFAULT_READINESS_CONFIG,
): TaskReadiness {
  // Never read anything after the mission clock.
  const factorsByKey = new Map(
    (input.summary?.factors ?? [])
      .filter((f) => f.measured_at === null || f.measured_at <= input.asOf)
      .map((f) => [f.factor, f]),
  );
  const measurement = new Map((input.health?.measurements ?? []).map((m) => [m.measure, m]));
  const night = latestSleep(input.sleep, input.asOf);
  const views = input.comparisons.filter((v) => v.comparison.calculated_at <= input.asOf);

  const results: FactorResult[] = config.factors.map((cfg) => {
    switch (cfg.key) {
      case 'sleep_duration':
        return referencedFactor(cfg, factorsByKey.get('sleep_duration'), input, config, {
          quality:
            night && night.sleep_end === factorsByKey.get('sleep_duration')?.measured_at
              ? night.quality_status
              : null,
        });
      case 'sleep_efficiency':
        return sleepBandFactor(
          cfg,
          night,
          (n) => n.sleep_efficiency_percent,
          config.sleepBands.sleep_efficiency,
          '%',
          input,
        );
      case 'sleep_interruptions':
        return sleepBandFactor(
          cfg,
          night,
          (n) => n.awakenings_count,
          config.sleepBands.sleep_interruptions,
          'awakenings',
          input,
        );
      case 'sleep_quality':
        return sleepBandFactor(
          cfg,
          night,
          (n) => n.sleep_quality_score,
          config.sleepBands.sleep_quality,
          'score',
          input,
        );
      case 'blood_pressure': {
        // No personal reference exists for blood pressure; it can only be reported.
        const m = measurement.get('blood_pressure');
        const out = blank(cfg);
        if (!m || m.value === null) return out;
        return {
          ...out,
          value: m.value,
          unit: m.unit,
          measuredAt: m.measured_at,
          state: 'no_reference',
        };
      }
      default: {
        if (cfg.category === 'cognitive') {
          const latest = views
            .filter((v) => v.daily_result.cognitive_domain === cfg.key)
            .sort((a, b) =>
              b.comparison.calculated_at.localeCompare(a.comparison.calculated_at),
            )[0];
          const f = factorsByKey.get(cfg.key);
          const valid = latest ? latest.daily_result.valid_trials > 0 : true;
          return referencedFactor(cfg, f, input, config, {
            quality: valid ? null : 'no_valid_trials',
            direction: directionForMetric(
              latest?.daily_result.metric_name ?? null,
              f?.unit ?? null,
            ),
            flagged: f?.reference_range_status === 'outside_reference',
          });
        }
        const m = measurement.get(cfg.key as never);
        return referencedFactor(cfg, factorsByKey.get(cfg.key), input, config, {
          quality: m?.quality_status ?? null,
        });
      }
    }
  });

  const categories: CategoryResult[] = (['recovery', 'vitals', 'cognitive'] as const).map(
    (category) => {
      const factors = results.filter((f) => f.category === category);
      const used = factors.filter((f) => f.state === 'scored');
      const usedWeight = used.reduce((n, f) => n + f.weight, 0);
      const requiredWeight = factors.filter((f) => f.required).reduce((n, f) => n + f.weight, 0);
      const usedRequired = used.filter((f) => f.required).reduce((n, f) => n + f.weight, 0);
      const coverage = requiredWeight > 0 ? usedRequired / requiredWeight : used.length > 0 ? 1 : 0;
      const score =
        usedWeight > 0
          ? used.reduce((n, f) => n + f.weight * f.contribution!, 0) / usedWeight
          : null;
      return { category, weight: config.categoryWeights[category], score, coverage, factors };
    },
  );

  const totalWeight = categories.reduce((n, c) => n + c.weight, 0);
  const coverage = categories.reduce((n, c) => n + c.weight * c.coverage, 0) / totalWeight;
  const withData = categories.filter((c) => c.score !== null);
  const dataWeight = withData.reduce((n, c) => n + c.weight, 0);
  const insufficient = coverage < config.minCoverage || withData.length < config.minCategories;
  const raw =
    dataWeight > 0 ? withData.reduce((n, c) => n + c.weight * c.score!, 0) / dataWeight : 0;

  return {
    status: insufficient ? 'insufficient_data' : 'estimated',
    score: insufficient ? null : Math.round(raw * 100),
    coverage,
    confidence: coverage >= 0.85 ? 'high' : coverage >= 0.6 ? 'moderate' : 'low',
    asOf: input.asOf,
    categories,
    factors: results,
  };
}
