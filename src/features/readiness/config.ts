/**
 * Task Readiness: DEMONSTRATION weighting configuration.
 *
 * These weights and thresholds are prototype defaults chosen for the AEGIS
 * demonstration so the estimate is deterministic and explainable. They are NOT
 * NASA clinical standards, they have not been validated, and they can be changed
 * here without touching the scoring code.
 *
 * Personal reference ranges (vitals, sleep duration, dose rate and cognition) come
 * from the backend. The absolute sleep bands below are used only where the backend
 * provides no personal reference.
 */

export type ReadinessCategory = 'recovery' | 'vitals' | 'cognitive';

/** Which side of a reference range counts against the estimate. */
export type Direction = 'higher_is_better' | 'lower_is_better' | 'both';

export interface FactorConfig {
  key: string;
  label: string;
  category: ReadinessCategory;
  /** Relative weight inside its category. */
  weight: number;
  direction: Direction;
  /**
   * Required factors count towards data coverage when missing. Optional ones (no
   * sensor configured on this mission) are reported but never lower coverage.
   */
  required: boolean;
  /** A reading older than this (relative to the mission clock) is stale and not used. */
  maxAgeHours: number;
}

export interface AbsoluteBand {
  /** Value at or beyond which the factor contributes fully. */
  good: number;
  /** Value at or beyond which it contributes nothing. */
  poor: number;
}

export interface ReadinessConfig {
  categoryWeights: Record<ReadinessCategory, number>;
  factors: FactorConfig[];
  /** Demonstration bands for sleep measures that have no personal reference. */
  sleepBands: {
    sleep_efficiency: AbsoluteBand;
    sleep_interruptions: AbsoluteBand;
    sleep_quality: AbsoluteBand;
  };
  /** Contribution just outside the reference range; it falls to 0 one range-width out. */
  outsideCeiling: number;
  /** Below this data coverage (0–1) no percentage is shown. */
  minCoverage: number;
  /** At least this many categories must contribute before a percentage is shown. */
  minCategories: number;
}

const DAY = 24;

export const DEFAULT_READINESS_CONFIG: ReadinessConfig = {
  categoryWeights: { recovery: 0.35, vitals: 0.35, cognitive: 0.3 },
  factors: [
    // Recovery & Sleep (the latest night only; sleep duration is not also counted as a vital).
    {
      key: 'sleep_duration',
      label: 'Sleep duration',
      category: 'recovery',
      weight: 0.4,
      direction: 'higher_is_better',
      required: true,
      maxAgeHours: 36,
    },
    {
      key: 'sleep_efficiency',
      label: 'Sleep efficiency',
      category: 'recovery',
      weight: 0.25,
      direction: 'higher_is_better',
      required: true,
      maxAgeHours: 36,
    },
    {
      key: 'sleep_interruptions',
      label: 'Sleep interruptions',
      category: 'recovery',
      weight: 0.15,
      direction: 'lower_is_better',
      required: true,
      maxAgeHours: 36,
    },
    {
      key: 'sleep_quality',
      label: 'Sleep quality',
      category: 'recovery',
      weight: 0.2,
      direction: 'higher_is_better',
      required: true,
      maxAgeHours: 36,
    },
    // Current vitals.
    {
      key: 'heart_rate',
      label: 'Heart rate',
      category: 'vitals',
      weight: 1,
      direction: 'both',
      required: true,
      maxAgeHours: DAY,
    },
    {
      key: 'hrv_rmssd',
      label: 'Heart rate variability',
      category: 'vitals',
      weight: 1,
      direction: 'higher_is_better',
      required: true,
      maxAgeHours: DAY,
    },
    {
      key: 'spo2',
      label: 'Blood oxygen',
      category: 'vitals',
      weight: 1,
      direction: 'higher_is_better',
      required: true,
      maxAgeHours: DAY,
    },
    {
      key: 'respiratory_rate',
      label: 'Respiratory rate',
      category: 'vitals',
      weight: 1,
      direction: 'both',
      required: true,
      maxAgeHours: DAY,
    },
    {
      key: 'body_temperature',
      label: 'Body temperature',
      category: 'vitals',
      weight: 1,
      direction: 'both',
      required: true,
      maxAgeHours: DAY,
    },
    {
      key: 'radiation_dose_rate',
      label: 'Radiation dose rate',
      category: 'vitals',
      weight: 1,
      direction: 'lower_is_better',
      required: true,
      maxAgeHours: 36,
    },
    {
      key: 'blood_pressure',
      label: 'Blood pressure',
      category: 'vitals',
      weight: 1,
      direction: 'both',
      required: false,
      maxAgeHours: DAY,
    },
    // Mission Mind domains. Direction is refined per metric (see directionForMetric).
    ...(
      [
        ['vigilance', 'Reaction time'],
        ['attention', 'Attention'],
        ['working_memory', 'Working memory'],
        ['processing_speed', 'Processing speed'],
        ['reasoning', 'Reasoning'],
        ['cognitive_flexibility', 'Cognitive flexibility'],
      ] as const
    ).map(([key, label]): FactorConfig => ({
      key,
      label,
      category: 'cognitive',
      weight: 1,
      direction: 'both',
      // Not every domain is played every day; a domain with no result is reported
      // as missing but only domains with results define cognitive coverage.
      required: false,
      maxAgeHours: 7 * DAY,
    })),
  ],
  sleepBands: {
    sleep_efficiency: { good: 85, poor: 65 },
    sleep_interruptions: { good: 1, poor: 6 },
    // sleep_records.sleep_quality_score is on a 0–10 scale.
    sleep_quality: { good: 7, poor: 3 },
  },
  outsideCeiling: 0.75,
  minCoverage: 0.5,
  minCategories: 2,
};

/** Direction for a cognitive metric, from its name or unit. */
export function directionForMetric(metricName: string | null, unit: string | null): Direction {
  const name = (metricName ?? '').toLowerCase();
  const u = (unit ?? '').toLowerCase();
  if (name.includes('reaction_time') || name.includes('switch_cost') || u === 'ms') {
    return 'lower_is_better';
  }
  if (
    name.includes('accuracy') ||
    name.includes('correct') ||
    name.includes('per_minute') ||
    u.includes('percent')
  ) {
    return 'higher_is_better';
  }
  return 'both';
}
