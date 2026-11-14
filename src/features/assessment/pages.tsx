/** Chunk entry for the assessment pages. */
import { AssessmentSessionPage } from './AssessmentSessionPage';

export { BaselinePage } from './BaselinePage';
export { MissionMindPage } from './MissionMindPage';
export { PreflightPage } from './PreflightPage';

export function StandardSessionPage() {
  return <AssessmentSessionPage theme="standard" />;
}

export function MissionSessionPage() {
  return <AssessmentSessionPage theme="mission" />;
}
