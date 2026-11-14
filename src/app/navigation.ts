/**
 * Role menus. This single list drives both the sidebar and the guarded routes,
 * so a menu item can never point at a page the role is not allowed to open.
 */
import {
  BarChart3,
  Bell,
  CalendarClock,
  CalendarRange,
  ClipboardList,
  Cpu,
  Database,
  FileText,
  FlaskConical,
  Gamepad2,
  GitCompare,
  HeartPulse,
  KeyRound,
  LayoutDashboard,
  Leaf,
  LineChart,
  ListTodo,
  Microscope,
  Moon,
  PersonStanding,
  PlayCircle,
  Satellite,
  ScrollText,
  Stethoscope,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@/api/types';

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  /** Build phase that delivers the real page. */
  phase: string;
  description: string;
}

export const NAV: Record<Role, NavItem[]> = {
  astronaut: [
    {
      label: 'Overview',
      path: '/astronaut',
      icon: LayoutDashboard,
      phase: '2',
      description: 'Measurement cards, daily readiness summary and cognitive snapshot.',
    },
    {
      label: 'Health Monitoring',
      path: '/astronaut/health',
      icon: HeartPulse,
      phase: '2',
      description: 'Time series for each measure, sleep and radiation.',
    },
    {
      label: 'Body Map',
      path: '/astronaut/body-map',
      icon: PersonStanding,
      phase: '3',
      description: 'Interactive body regions with their measurements.',
    },
    {
      label: 'Mission Mind',
      path: '/astronaut/mission-mind',
      icon: Gamepad2,
      phase: '4B',
      description: 'Daily cognitive mission games.',
    },
    {
      label: 'Cognitive Trends',
      path: '/astronaut/cognitive-trends',
      icon: LineChart,
      phase: '5',
      description: 'Inflight results against your preflight reference, per domain.',
    },
    {
      label: 'My Schedule',
      path: '/astronaut/schedule',
      icon: CalendarClock,
      phase: '2',
      description: 'Tasks, assessments, exercise and sleep for the day.',
    },
    {
      label: 'Recovery and Sleep',
      path: '/astronaut/recovery',
      icon: Moon,
      phase: '2',
      description: 'Scheduled supportive routines and sleep protection windows.',
    },
    {
      label: 'Alerts',
      path: '/astronaut/alerts',
      icon: Bell,
      phase: '2',
      description: 'Rule-generated alerts and their sync state.',
    },
  ],
  mission_leader: [
    {
      label: 'Planner Overview',
      path: '/planner',
      icon: LayoutDashboard,
      phase: '6',
      description: 'Crew operational overview and planning totals.',
    },
    {
      label: 'Task Pool',
      path: '/planner/tasks',
      icon: ListTodo,
      phase: '6',
      description: 'Mission tasks and their demand profiles.',
    },
    {
      label: 'Crew Schedule',
      path: '/planner/schedule',
      icon: CalendarRange,
      phase: '6',
      description: 'Generate, review, override and approve schedules.',
    },
    {
      label: 'Recovery Planning',
      path: '/planner/recovery',
      icon: Leaf,
      phase: '6',
      description: 'Supportive routine catalogue and recommendations.',
    },
    {
      label: 'Planning Effectiveness',
      path: '/planner/effectiveness',
      icon: BarChart3,
      phase: '7',
      description: 'Operational results of planning methods.',
    },
  ],
  medical_researcher: [
    {
      label: 'Research Overview',
      path: '/research',
      icon: Microscope,
      phase: '7',
      description: 'Participants, sessions, mission days and data quality.',
    },
    {
      label: 'Analyses',
      path: '/research/analyses',
      icon: FlaskConical,
      phase: '7',
      description: 'Build and run exploratory analyses.',
    },
    {
      label: 'Cognition Comparison',
      path: '/research/cognition',
      icon: GitCompare,
      phase: '7',
      description: 'Preflight and inflight cognition by domain.',
    },
    {
      label: 'Planning Effectiveness',
      path: '/research/effectiveness',
      icon: BarChart3,
      phase: '7',
      description: 'Operational results and health hypotheses, kept separate.',
    },
    {
      label: 'Reports',
      path: '/research/reports',
      icon: FileText,
      phase: '7',
      description: 'AI-drafted summaries of computed results.',
    },
  ],
  medical_officer: [
    {
      label: 'Oversight',
      path: '/medical',
      icon: Stethoscope,
      phase: '8',
      description: 'Completion and data quality per astronaut.',
    },
    {
      label: 'Assessment Programmes',
      path: '/medical/programmes',
      icon: ClipboardList,
      phase: '8',
      description: 'Build assessment protocols and assign them.',
    },
    {
      label: 'Access Grants',
      path: '/medical/access',
      icon: KeyRound,
      phase: '8',
      description: 'Grant and revoke assessment access.',
    },
    {
      label: 'Crew Assessments',
      path: '/medical/assessments',
      icon: Users,
      phase: '8',
      description: 'Sessions and results flagged for contextual review.',
    },
  ],
  mission_control_admin: [
    {
      label: 'Mission State',
      path: '/control',
      icon: Satellite,
      phase: '8',
      description: 'Mission clock, day and simulation status.',
    },
    {
      label: 'Simulation',
      path: '/control/simulation',
      icon: PlayCircle,
      phase: '8',
      description: 'Start, pause and select simulation runs.',
    },
    {
      label: 'Events',
      path: '/control/events',
      icon: Zap,
      phase: '8',
      description: 'Trigger and view predefined mission events.',
    },
    {
      label: 'Data Integrity',
      path: '/control/integrity',
      icon: Database,
      phase: '8',
      description: 'Data lineage, sync queue and conflicts.',
    },
    {
      label: 'AI Status',
      path: '/control/ai',
      icon: Cpu,
      phase: '8',
      description: 'Model status, response time and fallback state.',
    },
    {
      label: 'Audit',
      path: '/control/audit',
      icon: ScrollText,
      phase: '8',
      description: 'Audit log of changes.',
    },
  ],
};

export function isPathAllowed(role: Role, pathname: string): boolean {
  return NAV[role].some((item) => item.path === pathname);
}
