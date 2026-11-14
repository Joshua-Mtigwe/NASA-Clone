/**
 * Task Readiness Insights: fixed statement templates chosen by explicit rules over
 * the computed factors. No language model is involved. Every statement is shown
 * only when its condition holds, and none makes a diagnosis or a fitness claim.
 */
import type { FactorResult, TaskReadiness } from './score';

export type InsightTone = 'positive' | 'neutral' | 'attention';

export interface Insight {
  id: string;
  tone: InsightTone;
  category: 'recovery' | 'vitals' | 'cognitive' | 'data';
  text: string;
}

/** "a", "a and b", "a, b and c" in lower case. */
export function listLabels(factors: FactorResult[]): string {
  const names = factors.map((f) => f.label.toLowerCase());
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const is = (state: FactorResult['state']) => (f: FactorResult) => f.state === state;
const unfavourable = (f: FactorResult) => f.state === 'scored' && f.deviation === 'unfavourable';
/** One full reference-range width or more beyond the bound. */
const marked = (f: FactorResult) => unfavourable(f) && (f.distance ?? 0) >= 1;

export function buildInsights(r: TaskReadiness): Insight[] {
  const out: Insight[] = [];
  const get = (key: string) => r.factors.find((f) => f.key === key)!;
  const sleepFactors = r.factors.filter((f) => f.category === 'recovery');
  const vitals = r.factors.filter((f) => f.category === 'vitals');
  const cognitive = r.factors.filter((f) => f.category === 'cognitive');

  if (r.status === 'insufficient_data') {
    out.push({
      id: 'insufficient',
      tone: 'neutral',
      category: 'data',
      text: 'There is not enough recent, valid data to estimate your readiness. The estimate will appear once more measurements and assessments are available.',
    });
  }

  // ---- Recovery & Sleep ----
  const duration = get('sleep_duration');
  if (duration.state === 'scored') {
    if (duration.deviation === 'unfavourable') {
      out.push({
        id: 'sleep-duration-below',
        tone: 'attention',
        category: 'recovery',
        text: 'Your sleep duration is below your usual reference range, which has reduced your readiness estimate.',
      });
    } else {
      out.push({
        id: 'sleep-duration-within',
        tone: 'positive',
        category: 'recovery',
        text: 'Your last sleep duration is within or above your personal reference range.',
      });
    }
  }
  const efficiency = get('sleep_efficiency');
  if (efficiency.state === 'scored' && (efficiency.contribution ?? 1) < 1) {
    out.push({
      id: 'sleep-efficiency-low',
      tone: 'attention',
      category: 'recovery',
      text: 'Your sleep efficiency was below the demonstration target, which lowered the recovery part of your estimate.',
    });
  }
  const interruptions = get('sleep_interruptions');
  if (interruptions.state === 'scored' && (interruptions.contribution ?? 1) < 0.5) {
    out.push({
      id: 'sleep-interrupted',
      tone: 'attention',
      category: 'recovery',
      text: 'Your last sleep was interrupted several times, which lowered the recovery part of your estimate.',
    });
  }
  const quality = get('sleep_quality');
  if (quality.state === 'scored' && (quality.contribution ?? 1) < 0.5) {
    out.push({
      id: 'sleep-quality-low',
      tone: 'attention',
      category: 'recovery',
      text: 'Your recorded sleep quality was lower than usual for a restful night.',
    });
  }
  if (sleepFactors.every((f) => f.state === 'missing' || f.state === 'stale')) {
    out.push({
      id: 'sleep-unavailable',
      tone: 'neutral',
      category: 'recovery',
      text: 'No recent sleep record is available, so recovery could not be assessed.',
    });
  }
  if (sleepFactors.some(is('invalid'))) {
    out.push({
      id: 'sleep-invalid',
      tone: 'neutral',
      category: 'recovery',
      text: 'Your most recent sleep record did not pass quality checks and was not used.',
    });
  }

  // ---- Vitals ----
  const vitalsOut = vitals.filter(unfavourable);
  const vitalsMarked = vitalsOut.filter(marked);
  const vitalsMild = vitalsOut.filter((f) => !marked(f));
  if (vitalsMarked.length) {
    out.push({
      id: 'vitals-marked',
      tone: 'attention',
      category: 'vitals',
      text: `Your ${listLabels(vitalsMarked)} ${vitalsMarked.length === 1 ? 'differs' : 'differ'} markedly from your personal reference range and may benefit from contextual review.`,
    });
  }
  if (vitalsMild.length) {
    out.push({
      id: 'vitals-outside',
      tone: 'attention',
      category: 'vitals',
      text: `Your ${listLabels(vitalsMild)} ${vitalsMild.length === 1 ? 'is' : 'are'} outside your personal reference range and may benefit from contextual review.`,
    });
  }
  const vitalsScored = vitals.filter(is('scored'));
  if (vitalsScored.length >= 3 && vitalsOut.length === 0) {
    out.push({
      id: 'vitals-within',
      tone: 'positive',
      category: 'vitals',
      text: 'Your current vital signs are consistent with your personal reference values.',
    });
  }
  const vitalsStale = vitals.filter((f) => f.required && f.state === 'stale');
  if (vitalsStale.length) {
    out.push({
      id: 'vitals-stale',
      tone: 'neutral',
      category: 'vitals',
      text: `Your latest ${listLabels(vitalsStale)} ${vitalsStale.length === 1 ? 'reading is' : 'readings are'} out of date and ${vitalsStale.length === 1 ? 'was' : 'were'} not used.`,
    });
  }
  const vitalsInvalid = vitals.filter(is('invalid'));
  if (vitalsInvalid.length) {
    out.push({
      id: 'vitals-invalid',
      tone: 'neutral',
      category: 'vitals',
      text: `Your latest ${listLabels(vitalsInvalid)} ${vitalsInvalid.length === 1 ? 'reading' : 'readings'} did not pass quality checks and ${vitalsInvalid.length === 1 ? 'was' : 'were'} excluded.`,
    });
  }

  // ---- Cognitive (Mission Mind) ----
  const cogScored = cognitive.filter(is('scored'));
  const cogOut = cognitive.filter(unfavourable);
  const cogBetter = cognitive.filter((f) => f.state === 'scored' && f.deviation === 'favourable');
  if (cogOut.length) {
    out.push({
      id: 'cognitive-outside',
      tone: 'attention',
      category: 'cognitive',
      text: `Your recent ${listLabels(cogOut)} ${cogOut.length === 1 ? 'result is' : 'results are'} outside your personal baseline range, which has reduced your readiness estimate.`,
    });
  }
  if (cogScored.length && cogOut.length === 0 && cogBetter.length === 0) {
    out.push({
      id: 'cognitive-within',
      tone: 'positive',
      category: 'cognitive',
      text:
        cogScored.length === 1
          ? 'Your recent cognitive assessment is within your personal baseline range.'
          : 'Your recent cognitive assessments are within your personal baseline ranges.',
    });
  }
  if (cogBetter.length) {
    out.push({
      id: 'cognitive-favourable',
      tone: 'positive',
      category: 'cognitive',
      text: `Your recent ${listLabels(cogBetter)} ${cogBetter.length === 1 ? 'result is' : 'results are'} beyond your baseline range in the favourable direction.`,
    });
  }
  if (cogScored.length === 0) {
    out.push({
      id: 'cognitive-unavailable',
      tone: 'neutral',
      category: 'cognitive',
      text: 'No Mission Mind result from the last 7 days is available, so cognition is not part of this estimate.',
    });
  }
  if (cognitive.some(is('invalid'))) {
    out.push({
      id: 'cognitive-invalid',
      tone: 'neutral',
      category: 'cognitive',
      text: 'A recent assessment had no valid trials and was not used.',
    });
  }

  // ---- Data completeness ----
  const missingRequired = r.factors.filter(
    (f) =>
      f.required &&
      (f.state === 'missing' ||
        f.state === 'stale' ||
        f.state === 'invalid' ||
        f.state === 'no_reference'),
  );
  if (r.status === 'estimated' && (missingRequired.length > 0 || r.confidence !== 'high')) {
    out.push({
      id: 'uncertainty',
      tone: 'neutral',
      category: 'data',
      text: 'Some measurements are unavailable, so your readiness estimate contains additional uncertainty.',
    });
  }
  const noReference = r.factors.filter((f) => f.state === 'no_reference');
  if (noReference.length) {
    out.push({
      id: 'no-reference',
      tone: 'neutral',
      category: 'data',
      text: `Your ${listLabels(noReference)} ${noReference.length === 1 ? 'has' : 'have'} no personal reference yet, so ${noReference.length === 1 ? 'it is' : 'they are'} not included in the estimate.`,
    });
  }
  if (
    r.status === 'estimated' &&
    (r.score ?? 0) >= 85 &&
    !out.some((i) => i.tone === 'attention')
  ) {
    out.unshift({
      id: 'overall-consistent',
      tone: 'positive',
      category: 'data',
      text: 'Your current measurements are generally consistent with your personal reference values.',
    });
  }
  return out;
}
