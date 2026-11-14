import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { recoveryApi } from '@/api/recovery';
import { DataState, PageHeader, StatusBadge } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useRecoveryCatalogue } from '@/features/health/hooks';
import { useMissionState } from '@/features/shell/useMissionState';
import { humanise } from '@/lib/format';
import { statusOf } from '@/lib/queryState';
import { useCrew } from './hooks';

export function RecoveryPlanningPage() {
  const mission = useMissionState();
  const crew = useCrew();
  const catalogue = useRecoveryCatalogue();
  const [astronaut, setAstronaut] = useState('AST-001');
  const missionDay = mission.data?.mission_day ?? 1;
  const recommend = useMutation({
    mutationFn: () => recoveryApi.recommend({ astronaut_id: astronaut, mission_day: missionDay }),
  });
  const activities = new Map((catalogue.data ?? []).map((a) => [a.recovery_activity_id, a]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recovery Planning"
        description="Supportive routines that can be placed in the crew schedule."
      />

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <label className="space-y-1 text-label text-ink-muted">
          Astronaut
          <select
            value={astronaut}
            onChange={(e) => setAstronaut(e.target.value)}
            className="h-9 w-full rounded-md border bg-surface-sunken px-2 text-sm text-ink"
          >
            {(crew.data ?? []).map((a) => (
              <option key={a.astronaut_id} value={a.astronaut_id}>
                {a.astronaut_code}
              </option>
            ))}
          </select>
        </label>
        <span className="text-sm text-ink-muted">Mission day {missionDay}</span>
        <Button onClick={() => recommend.mutate()} disabled={recommend.isPending}>
          Get recommendations
        </Button>
      </Card>

      {(recommend.isPending || recommend.isError || recommend.data) && (
        <section aria-labelledby="rec-title" className="space-y-3">
          <h2 id="rec-title" className="text-title">
            Recommended supportive routines
          </h2>
          <DataState
            status={statusOf(recommend, (recommend.data ?? []).length === 0)}
            error={recommend.error}
            emptyMessage="No supportive routines are recommended for this day."
          >
            <ol className="space-y-2" data-testid="recommendations">
              {(recommend.data ?? []).map((r, i) => {
                const a = activities.get(r.recovery_activity_id);
                return (
                  <li key={r.recommendation_id}>
                    <Card className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4">
                      <span className="text-label text-ink-subtle">#{i + 1}</span>
                      <span className="font-medium text-ink">
                        {a?.activity_name ?? r.recovery_activity_id}
                      </span>
                      <span className="text-sm text-ink-muted">
                        {a
                          ? `${humanise(a.activity_category)} · ${a.recommended_duration_minutes} min`
                          : ''}
                      </span>
                      <span className="w-full text-caption text-ink-muted">
                        Reason: {r.reason} · {r.algorithm_version}
                      </span>
                      <StatusBadge
                        status={r.approval_status === 'approved' ? 'nominal' : 'review'}
                        label={
                          r.approval_status === 'approved' ? 'Approved' : 'Awaiting medical review'
                        }
                      />
                    </Card>
                  </li>
                );
              })}
            </ol>
          </DataState>
        </section>
      )}

      <section aria-labelledby="catalogue-title" className="space-y-3">
        <h2 id="catalogue-title" className="text-title">
          Catalogue
        </h2>
        <DataState
          status={statusOf(catalogue, (catalogue.data ?? []).length === 0)}
          error={catalogue.error}
        >
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(catalogue.data ?? []).map((a) => (
              <li key={a.recovery_activity_id}>
                <Card className="space-y-1 p-4" data-testid="catalogue-item">
                  <p className="font-medium text-ink">{a.activity_name}</p>
                  <p className="text-caption text-ink-subtle">
                    {humanise(a.activity_category)} · {a.recommended_duration_minutes} min ·{' '}
                    {humanise(a.intensity)} intensity
                  </p>
                  <p className="text-sm text-ink-muted">{a.description}</p>
                </Card>
              </li>
            ))}
          </ul>
        </DataState>
      </section>
    </div>
  );
}
