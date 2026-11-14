/** Mock stand-in for the backend's cognition summary statistics. */
import type { CognitionDomainSummary, CognitionSummary, CompletionDay } from '@/api/types';
import { table } from '../db';
import { currentMissionState } from './mission';
import { median } from './scoring';

const round = (n: number | null, d = 2) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);

function sd(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1));
}

export async function cognitionSummary(
  astronautId: string,
  from: string | undefined,
  to: string | undefined,
): Promise<CognitionSummary> {
  const { mission_time: now } = await currentMissionState();
  const today = now.slice(0, 10);
  const end = to && to < today ? to : today;
  const inRange = (date: string) => (!from || date >= from) && date <= end;

  const [daily, baselines, comparisons, sessions, results] = await Promise.all([
    table('daily_cognitive_results'),
    table('cognitive_baselines'),
    table('cognitive_comparisons'),
    table('assessment_sessions'),
    table('assessment_results'),
  ]);

  const mineDaily = daily.filter(
    (d) => d.astronaut_id === astronautId && inRange(d.assessment_date) && d.calculated_at <= now,
  );
  const preflightSessions = new Set(
    sessions
      .filter(
        (s) =>
          s.astronaut_id === astronautId &&
          s.mission_phase === 'preflight' &&
          s.session_status === 'completed',
      )
      .map((s) => s.session_id),
  );
  const dailyIds = new Set(mineDaily.map((d) => d.daily_result_id));
  const mineComparisons = comparisons.filter((c) => dailyIds.has(c.daily_result_id));

  const domains = [...new Set(mineDaily.map((d) => d.cognitive_domain))].filter(
    (d) => d !== 'subjective_fatigue',
  );
  const summaries: CognitionDomainSummary[] = domains.map((domain) => {
    const rows = mineDaily.filter((d) => d.cognitive_domain === domain);
    const inflight = rows.map((d) => d.daily_median);
    const preflight = results
      .filter((r) => preflightSessions.has(r.session_id) && r.cognitive_domain === domain)
      .map((r) => r.metric_value);
    const refs = baselines
      .filter((b) => b.astronaut_id === astronautId && b.cognitive_domain === domain)
      .map((b) => b.median_value);
    const domainIds = new Set(rows.map((r) => r.daily_result_id));
    const cmp = mineComparisons.filter((c) => domainIds.has(c.daily_result_id));
    return {
      cognitive_domain: domain,
      metric_name: rows[0]!.metric_name,
      metric_unit: rows[0]!.metric_unit,
      preflight_reference_median: round(median(refs)),
      inflight_median: round(median(inflight)),
      preflight_sd: round(sd(preflight)),
      inflight_sd: round(sd(inflight)),
      n_preflight: preflight.length,
      n_inflight: inflight.length,
      within_reference: cmp.filter((c) => c.reference_range_status === 'within_reference').length,
      outside_reference: cmp.filter((c) => c.reference_range_status === 'outside_reference').length,
      preflight_values: preflight,
      inflight_values: inflight,
    };
  });

  // Completion per inflight day: completed sessions against the 4 sessions the
  // daily template (TPL-FLIGHT: PVT, NBACK, STROOP, SURVEY) expects.
  const byDay = new Map<string, number>();
  for (const s of sessions) {
    if (
      s.astronaut_id !== astronautId ||
      s.mission_phase !== 'inflight' ||
      s.session_status !== 'completed'
    )
      continue;
    if (s.completed_at > now) continue;
    const day = s.completed_at.slice(0, 10);
    if (!inRange(day)) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const days: CompletionDay[] = [];
  const { mission } = await currentMissionState();
  const start =
    from && from > mission.launch_date.slice(0, 10) ? from : mission.launch_date.slice(0, 10);
  for (
    let t = Date.parse(`${start}T00:00:00Z`);
    t <= Date.parse(`${end}T00:00:00Z`);
    t += 86_400_000
  ) {
    const date = new Date(t).toISOString().slice(0, 10);
    days.push({ date, sessions_completed: byDay.get(date) ?? 0, sessions_expected: 4 });
  }

  return {
    astronaut_id: astronautId,
    from: from ?? null,
    to: end,
    domains: summaries,
    completion_by_day: days,
  };
}
