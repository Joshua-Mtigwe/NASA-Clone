import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { RouteObject } from 'react-router';
import { RequireAuth, RequireRole, RoleHomeRedirect } from '@/features/auth/guards';
import { LoginPage } from '@/features/auth/LoginPage';
import { AppShell } from '@/features/shell/AppShell';
import { ForbiddenPage } from '@/pages/ForbiddenPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { PlaceholderPage } from '@/pages/PlaceholderPage';
import { NAV } from './navigation';
import { ROLES } from './roles';

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
const control = () => import('@/features/control/ControlPages');

const PAGES: Record<string, Page> = {
  '/astronaut': page(health, 'OverviewPage'),
  '/astronaut/health': page(health, 'HealthMonitoringPage'),
  '/astronaut/body-map': page(() => import('@/features/bodymap/BodyMapPage'), 'BodyMapPage'),
  '/astronaut/mission-mind': page(assessment, 'MissionMindPage'),
  '/astronaut/cognitive-trends': page(cognition, 'CognitiveTrendsPage'),
  '/astronaut/schedule': page(health, 'SchedulePage'),
  '/astronaut/recovery': page(health, 'RecoverySleepPage'),
  '/astronaut/alerts': page(health, 'AlertsPage'),
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
  '/control': page(control, 'MissionStatePage'),
  '/control/simulation': page(control, 'SimulationPage'),
  '/control/events': page(control, 'EventsPage'),
  '/control/integrity': page(control, 'DataIntegrityPage'),
  '/control/ai': page(control, 'AiStatusPage'),
  '/control/audit': page(control, 'AuditPage'),
};

const PreflightPage = page(assessment, 'PreflightPage');
const BaselinePage = page(assessment, 'BaselinePage');
const StandardSession = page(assessment, 'StandardSessionPage');
const MissionSession = page(assessment, 'MissionSessionPage');
const AnalysisPage = page(research, 'AnalysisPage');

function pageFor(item: (typeof NAV)[keyof typeof NAV][number]) {
  const Component = PAGES[item.path];
  return Component ? <Component /> : <PlaceholderPage item={item} />;
}

/** Every role page, guarded by the role whose menu lists it. */
const rolePages: RouteObject[] = ROLES.flatMap((role) =>
  NAV[role].map((item) => ({
    path: item.path,
    element: <RequireRole roles={[role]}>{pageFor(item)}</RequireRole>,
  })),
);

/** Pages reached from other pages rather than the menu. */
const extras: RouteObject[] = [
  { path: '/astronaut/preflight', role: 'astronaut', Component: PreflightPage },
  { path: '/astronaut/preflight/:assignmentId', role: 'astronaut', Component: StandardSession },
  { path: '/astronaut/mission-mind/:assignmentId', role: 'astronaut', Component: MissionSession },
  { path: '/astronaut/baseline', role: 'astronaut', Component: BaselinePage },
  { path: '/research/analyses/:analysisId', role: 'medical_researcher', Component: AnalysisPage },
].map(({ path, role, Component }) => ({
  path,
  element: (
    <RequireRole roles={[role as (typeof ROLES)[number]]}>
      <Component />
    </RequireRole>
  ),
}));

export const appRoutes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
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
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
