import { PageHeader } from '@/components/shared';
import { MindCompanion } from '@/features/mind/MindCompanion';
import { TaskReadinessCard } from '@/features/readiness/TaskReadinessCard';

/**
 * Astronaut Overview: the Task Readiness estimate and its insights, then the AEGIS
 * Mind Companion. The two are independent: conversations never feed the estimate.
 */
export function OverviewPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description="Your task readiness estimate, what is shaping it, and your Mind Companion."
      />
      <TaskReadinessCard />
      <MindCompanion />
    </div>
  );
}
