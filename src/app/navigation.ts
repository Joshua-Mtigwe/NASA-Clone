/**
 * Role menus. This single structure drives both the sidebar and the guarded routes,
 * so a menu item can never point at a page the role is not allowed to open.
 * A menu entry is either a page link or a collapsible group of page links; groups
 * are navigation categories only and have no page of their own.
 */
import {
  Activity,
  BarChart3,
  Brain,
  CalendarClock,
  CalendarRange,
  ClipboardList,
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
  Stethoscope,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { DashboardRole } from './roles';

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  /** Build phase that delivers the real page. */
  phase: string;
  description: string;
}

export interface NavGroup {
  /** Stable id, used for the expand/collapse state. */
  id: string;
  label: string;
  icon: LucideIcon;
  children: NavItem[];
}

export type NavEntry = NavItem | NavGroup;

export function isNavGroup(entry: NavEntry): entry is NavGroup {
  return 'children' in entry;
}

export const NAV: Record<DashboardRole, NavEntry[]> = {
  astronaut: [
    {
      label: 'Overview',
      path: '/astronaut',
      icon: LayoutDashboard,
      phase: '10',
      description: 'Task readiness estimate, its insights, and the AEGIS Mind Companion.',
    },
    {
      id: 'health',
      label: 'Health Monitoring',
      icon: HeartPulse,
      children: [
        {
          label: 'Current Vitals',
          path: '/astronaut/health/vitals',
          icon: Activity,
          phase: '10',
          description: 'The latest value of each measure.',
        },
        {
          label: 'Vital Trends',
          path: '/astronaut/health/trends',
          icon: TrendingUp,
          phase: '2',
          description: 'Time series for each measure, sleep and radiation.',
        },
        {
          label: 'Body Map',
          path: '/astronaut/health/body-map',
          icon: PersonStanding,
          phase: '3',
          description: 'Interactive body regions with their measurements.',
        },
      ],
    },
    {
      id: 'cognition',
      label: 'Cognitive Metrics',
      icon: Brain,
      children: [
        {
          label: 'Mission Mind',
          path: '/astronaut/cognition/mission-mind',
          icon: Gamepad2,
          phase: '4B',
          description: 'Daily cognitive mission games.',
        },
        {
          label: 'Cognitive Trends',
          path: '/astronaut/cognition/trends',
          icon: LineChart,
          phase: '5',
          description: 'Inflight results against your preflight reference, per domain.',
        },
      ],
    },
    {
      label: 'My Schedule',
      path: '/astronaut/schedule',
      icon: CalendarClock,
      phase: '10',
      description: 'Your day as a timetable, with published supportive routines.',
    },
    {
      label: 'Recovery & Sleep',
      path: '/astronaut/recovery',
      icon: Moon,
      phase: '2',
      description: 'Scheduled supportive routines and sleep protection windows.',
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
      phase: '10',
      description: 'Supportive routine recommendations, published to astronaut schedules.',
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
};

/** Every page link in a role's menu, groups flattened, in menu order. */
export function navItems(role: DashboardRole): NavItem[] {
  return NAV[role].flatMap((entry) => (isNavGroup(entry) ? entry.children : [entry]));
}

export function isPathAllowed(role: DashboardRole, pathname: string): boolean {
  return navItems(role).some((item) => item.path === pathname);
}

/**
 * Earlier astronaut paths, kept working as redirects so bookmarks and links from
 * before the menu was regrouped still land on the right page.
 */
export const LEGACY_REDIRECTS: Array<{ from: string; to: string }> = [
  { from: '/astronaut/health', to: '/astronaut/health/trends' },
  { from: '/astronaut/body-map', to: '/astronaut/health/body-map' },
  { from: '/astronaut/mission-mind', to: '/astronaut/cognition/mission-mind' },
  { from: '/astronaut/cognitive-trends', to: '/astronaut/cognition/trends' },
  // Alerts was removed from the astronaut dashboard.
  { from: '/astronaut/alerts', to: '/astronaut' },
];
