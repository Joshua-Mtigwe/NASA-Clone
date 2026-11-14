import type { Role } from '@/api/types';

/**
 * Roles that have a dashboard. `mission_control_admin` remains a backend role (the
 * simulation, audit and data-integrity endpoints still exist for it), but it has no
 * dashboard and cannot be selected in this application.
 */
export type DashboardRole = Exclude<Role, 'mission_control_admin'>;

export const ROLES: readonly DashboardRole[] = [
  'astronaut',
  'mission_leader',
  'medical_researcher',
  'medical_officer',
];

export function isDashboardRole(role: Role | null | undefined): role is DashboardRole {
  return !!role && (ROLES as readonly string[]).includes(role);
}

/**
 * Display names. The internal id `medical_researcher` is kept for backend and
 * permission compatibility; the role is presented as "Impact Reviewer".
 */
export const ROLE_LABELS: Record<DashboardRole, string> = {
  astronaut: 'Astronaut',
  mission_leader: 'Mission Planning Leader',
  medical_researcher: 'Impact Reviewer',
  medical_officer: 'Medical Officer',
};

export const ROLE_HOME: Record<DashboardRole, string> = {
  astronaut: '/astronaut',
  mission_leader: '/planner',
  medical_researcher: '/research',
  medical_officer: '/medical',
};

/** Roles that can switch the active astronaut in the header. */
export const CAN_SELECT_ASTRONAUT: readonly Role[] = ['medical_officer', 'medical_researcher'];
