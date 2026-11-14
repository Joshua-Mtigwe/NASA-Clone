/* eslint-disable react-refresh/only-export-components */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { Navigate, useParams, type RouteObject } from 'react-router';
import { RequireAuth, RequireRole, RoleHomeRedirect } from '@/features/auth/guards';
import { RoleSelectPage } from '@/features/auth/RoleSelectPage';
import { AppShell } from '@/features/shell/AppShell';
import { ForbiddenPage } from '@/pages/ForbiddenPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { PlaceholderPage } from '@/pages/PlaceholderPage';
import { LEGACY_REDIRECTS, navItems, type NavItem } from './navigation';
import { ROLES, type DashboardRole } from './roles';

type Page = LazyExoticComponent<ComponentType>;

/** Route-level code splitting: each page is its own chunk, loaded on first visit. */
function page<M extends Record<string, unknown>>(
  load: () => Promise<M>,
  name: keyof M & string,
): Page {
  return lazy(() => load().then((m) => ({ default: m[name] as ComponentType })));
}

const health = () => import('@/features/health/pages');
const assessment = () => import('@/features/assessment/pages');
const cognition = () => import('@/features/cognition/CognitiveTrendsPage');
const planning = () => import('@/features/planning/pages');
const research = () => import('@/features/research/pages');
const medical = () => import('@/features/medical/MedicalPages');

const PAGES: Record<string, Page> = {
  '/astronaut': page(health, 'OverviewPage'),
  '/astronaut/health/vitals': page(health, 'CurrentVitalsPage'),
  '/astronaut/health/trends': page(health, 'VitalTrendsPage'),
  '/astronaut/health/body-map': page(() => import('@/features/bodymap/BodyMapPage'), 'BodyMapPage'),
  '/astronaut/cognition/mission-mind': page(assessment, 'MissionMindPage'),
  '/astronaut/cognition/trends': page(cognition, 'CognitiveTrendsPage'),
  '/astronaut/schedule': page(health, 'SchedulePage'),
  '/astronaut/recovery': page(health, 'RecoverySleepPage'),
  '/planner': page(planning, 'PlannerOverviewPage'),
  '/planner/tasks': page(planning, 'TaskPoolPage'),
  '/planner/schedule': page(planning, 'CrewSchedulePage'),
  '/planner/recovery': page(planning, 'RecoveryPlanningPage'),
  '/planner/effectiveness': page(research, 'PlanningEffectivenessPage'),
  '/research': page(research, 'ResearchOverviewPage'),
  '/research/analyses': page(research, 'AnalysesPage'),
  '/research/cognition': page(cognition, 'ResearchCognitionPage'),
  '/research/effectiveness': page(research, 'PlanningEffectivenessPage'),
  '/research/reports': page(research, 'ReportsPage'),
  '/medical': page(medical, 'OversightPage'),
  '/medical/programmes': page(medical, 'ProgrammesPage'),
  '/medical/access': page(medical, 'AccessGrantsPage'),
  '/medical/assessments': page(medical, 'CrewAssessmentsPage'),
};

const PreflightPage = page(assessment, 'PreflightPage');
const BaselinePage = page(assessment, 'BaselinePage');
const StandardSession = page(assessment, 'StandardSessionPage');
const MissionSession = page(assessment, 'MissionSessionPage');
const AnalysisPage = page(research, 'AnalysisPage');

/** Path of the Mission Mind session runner. */
export const MISSION_SESSION_BASE = '/astronaut/cognition/mission-mind';

function pageFor(item: NavItem) {
  const Component = PAGES[item.path];
  return Component ? <Component /> : <PlaceholderPage item={item} />;
}

/** Every role page, guarded by the role whose menu lists it. */
const rolePages: RouteObject[] = ROLES.flatMap((role) =>
  navItems(role).map((item) => ({
    path: item.path,
    element: <RequireRole roles={[role]}>{pageFor(item)}</RequireRole>,
  })),
);

/** Pages reached from other pages rather than the menu. */
const extras: RouteObject[] = (
  [
    { path: '/astronaut/preflight', role: 'astronaut', Component: PreflightPage },
    { path: '/astronaut/preflight/:assignmentId', role: 'astronaut', Component: StandardSession },
    {
      path: `${MISSION_SESSION_BASE}/:assignmentId`,
      role: 'astronaut',
      Component: MissionSession,
    },
    { path: '/astronaut/baseline', role: 'astronaut', Component: BaselinePage },
    {
      path: '/research/analyses/:analysisId',
      role: 'medical_researcher',
      Component: AnalysisPage,
    },
  ] satisfies Array<{ path: string; role: DashboardRole; Component: Page }>
).map(({ path, role, Component }) => ({
  path,
  element: (
    <RequireRole roles={[role]}>
      <Component />
    </RequireRole>
  ),
}));

/** Old Mission Mind session links keep working. */
function LegacyMissionSession() {
  const { assignmentId } = useParams();
  return <Navigate to={`${MISSION_SESSION_BASE}/${assignmentId ?? ''}`} replace />;
}

const redirects: RouteObject[] = [
  ...LEGACY_REDIRECTS.map(({ from, to }) => ({
    path: from,
    element: <Navigate to={to} replace />,
  })),
  { path: '/astronaut/mission-mind/:assignmentId', element: <LegacyMissionSession /> },
];

export const appRoutes: RouteObject[] = [
  { path: '/login', element: <RoleSelectPage /> },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <RoleHomeRedirect /> },
      { path: '/403', element: <ForbiddenPage /> },
      ...rolePages,
      ...extras,
      ...redirects,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
