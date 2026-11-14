import type { Role } from '@/api/types';

export const ROLES: readonly Role[] = [
  'astronaut',
  'mission_leader',
  'medical_researcher',
  'medical_officer',
  'mission_control_admin',
];

export const ROLE_LABELS: Record<Role, string> = {
  astronaut: 'Astronaut',
  mission_leader: 'Mission Planning Leader',
  medical_researcher: 'Medical Researcher',
  medical_officer: 'Medical Officer',
  mission_control_admin: 'Mission Control Administrator',
};

export const ROLE_HOME: Record<Role, string> = {
  astronaut: '/astronaut',
  mission_leader: '/planner',
  medical_researcher: '/research',
  medical_officer: '/medical',
  mission_control_admin: '/control',
};

/** Roles that can switch the active astronaut in the header. */
export const CAN_SELECT_ASTRONAUT: readonly Role[] = ['medical_officer', 'medical_researcher'];
