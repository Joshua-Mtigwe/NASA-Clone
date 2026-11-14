/**
 * Mock-only rows appended to CSV-derived tables. Each fills a gap where the build
 * plan needs something the CSVs do not contain. They exist only in mock mode, use
 * a MOCK id prefix or "(mock-only seed)" wording, and should be removed once the
 * CSVs or the backend provide the real rows.
 */
import type {
  AssessmentProtocolsRow,
  AssessmentScheduleTemplatesRow,
  RolesRow,
  UsersRow,
} from '@/types/tables';

// --- Mission Control Administrator (Phase 1): not in roles.csv / users.csv ---

export const MOCK_ADMIN_ROLE: RolesRow = {
  role_id: 'ROLE-MOCK-5',
  role_name: 'mission_control_admin',
  description: 'Mission control (mock-only seed, not in roles.csv)',
};

export const MOCK_ADMIN_USER: UsersRow = {
  user_id: 'USR-MOCK-ADMIN',
  username: 'mission_control',
  email: 'mission_control@example.invalid',
  password_hash: 'DEMO_ACCOUNT_NO_PASSWORD',
  role_id: MOCK_ADMIN_ROLE.role_id,
  account_status: 'active',
  created_at: '2027-02-01T00:00:00Z',
  last_login_at: '',
};

// --- Phase 4B tests with no assessment_protocols.csv row ---

export const MOCK_PROTOCOLS: AssessmentProtocolsRow[] = [
  {
    protocol_id: 'SYMBOL',
    protocol_name: 'Symbol-Digit Matching',
    test_type: 'SYMBOL',
    protocol_version: 'v1',
    duration_seconds: 90,
    instructions: 'Match each symbol to its digit using the key (mock-only seed)',
    scoring_method: 'correct_responses_per_minute',
    is_active: true,
  },
  {
    protocol_id: 'ROTATION',
    protocol_name: 'Navigation Challenge',
    test_type: 'ROTATION',
    protocol_version: 'v1',
    duration_seconds: 120,
    instructions: 'Decide whether the rotated shape is the same or mirrored (mock-only seed)',
    scoring_method: 'accuracy_percent',
    is_active: true,
  },
  {
    protocol_id: 'REASONING',
    protocol_name: 'Logical Reasoning',
    test_type: 'REASONING',
    protocol_version: 'v1',
    duration_seconds: 300,
    instructions: 'Choose the number that continues each series (mock-only seed)',
    scoring_method: 'accuracy_percent',
    is_active: true,
  },
];

/**
 * Demo templates used by the mock scheduler (src/mocks/compute/scheduler.ts) so the
 * preflight area and Mission Mind have sessions to run at the current mission clock.
 * Every CSV assignment is already completed.
 */
export const MOCK_TEMPLATES: AssessmentScheduleTemplatesRow[] = [
  {
    template_id: 'TPL-MOCK-PRE-DEMO',
    mission_phase: 'preflight',
    assessment_condition: 'morning',
    local_hour: 8,
    protocol_ids: 'PVT|NBACK|STROOP|SYMBOL|ROTATION|SWITCH|REASONING|SURVEY',
    recurrence: 'on_demand',
    description: 'Preflight battery demo (mock-only seed)',
  },
  {
    template_id: 'TPL-MOCK-MISSION-MIND',
    mission_phase: 'inflight',
    assessment_condition: 'morning',
    local_hour: 8,
    protocol_ids: 'PVT|NBACK|STROOP|ROTATION|SWITCH|SURVEY',
    recurrence: 'daily_rotation',
    description: 'Daily Mission Mind, two games a day plus the check-in (mock-only seed)',
  },
];

export const MOCK_SEEDS: {
  roles: RolesRow[];
  users: UsersRow[];
  assessment_protocols: AssessmentProtocolsRow[];
  assessment_schedule_templates: AssessmentScheduleTemplatesRow[];
} = {
  roles: [MOCK_ADMIN_ROLE],
  users: [MOCK_ADMIN_USER],
  assessment_protocols: MOCK_PROTOCOLS,
  assessment_schedule_templates: MOCK_TEMPLATES,
};
