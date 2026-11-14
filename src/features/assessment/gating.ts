import type { DueAssessment } from '@/api/types';

/** Start is allowed only when the backend says the session is authorised and conditions are met. */
export function canStart(d: DueAssessment): boolean {
  return d.authorized && d.conditions_met;
}
