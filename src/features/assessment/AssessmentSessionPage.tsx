import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { DueAssessment } from '@/api/types';
import { DataState, PageHeader } from '@/components/shared';
import { useAstronautContext } from '@/features/health/hooks';
import { AssessmentRunner } from './AssessmentRunner';
import { useDueAssessments } from './hooks';
import { canStart } from './gating';
import type { Theme } from './StimulusView';

export function AssessmentSessionPage({ theme }: { theme: Theme }) {
  const { assignmentId } = useParams();
  const navigate = useNavigate();
  const { astronautId } = useAstronautContext();
  const due = useDueAssessments(astronautId);
  const found = due.data?.find((d) => d.assignment.assignment_id === assignmentId);
  // Keep the session once opened: after completion it leaves the due list.
  const [held, setHeld] = useState<DueAssessment | null>(null);
  useEffect(() => {
    if (found && !held && canStart(found)) setHeld(found);
  }, [found, held]);
  const item = held ?? found;
  const back = theme === 'mission' ? '/astronaut/cognition/mission-mind' : '/astronaut/preflight';

  return (
    <div className="space-y-6">
      <PageHeader title={theme === 'mission' ? 'Mission Mind' : 'Preflight session'} />
      <DataState
        status={
          held
            ? 'ready'
            : due.isPending
              ? 'loading'
              : due.isError
                ? 'error'
                : item && canStart(item)
                  ? 'ready'
                  : 'empty'
        }
        error={due.error}
        emptyMessage={
          item
            ? (item.blocking_reason ?? 'This session cannot be started now.')
            : 'This session is not available.'
        }
      >
        {item && <AssessmentRunner due={item} theme={theme} onExit={() => void navigate(back)} />}
      </DataState>
      {!held && (!item || !canStart(item)) && !due.isPending && (
        <Link to={back} className="text-accent underline-offset-4 hover:underline">
          Back to the session list
        </Link>
      )}
    </div>
  );
}
