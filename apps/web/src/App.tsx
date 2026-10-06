import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { TODOS_HOME_PATH } from '@/routes';
import { isDesktopHost } from '@/host';
import {
  loadActivity,
  loadDays,
  loadExtensionAuth,
  loadExtractJobs,
  loadHabits,
  loadInbox,
  loadInboxReader,
  loadLanding,
  loadLogin,
  loadMemory,
  loadNotFound,
  loadOnboarding,
  loadRegister,
  loadReports,
  loadSearch,
  loadSettings,
  loadShell,
  loadThread,
  loadThreads,
  loadToday,
  loadTodos,
  loadUsage,
  trackRoute,
} from '@/shell/route-loaders';
import { GuestOnly, RequireAuth, RootEntry } from '@/shell/require-auth';
import { RouteErrorBoundary } from '@/shell/route-error-boundary';
import { RouteFallback } from '@/shell/route-fallback';
import { RouteProgress } from '@/shell/route-progress';

const LandingPage = lazy(() => trackRoute(loadLanding).then((m) => ({ default: m.LandingPage })));
const LoginPage = lazy(() => trackRoute(loadLogin).then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() =>
  trackRoute(loadRegister).then((m) => ({ default: m.RegisterPage })),
);
const OnboardingPage = lazy(() =>
  trackRoute(loadOnboarding).then((m) => ({ default: m.OnboardingPage })),
);
const ExtensionAuthPage = lazy(() =>
  trackRoute(loadExtensionAuth).then((m) => ({ default: m.ExtensionAuthPage })),
);
const Shell = lazy(() => trackRoute(loadShell).then((m) => ({ default: m.Shell })));
const TodayWorkspace = lazy(() =>
  trackRoute(loadToday).then((m) => ({ default: m.TodayWorkspace })),
);
const ThreadWorkspace = lazy(() =>
  trackRoute(loadThread).then((m) => ({ default: m.ThreadWorkspace })),
);
const TodosWorkspace = lazy(() =>
  trackRoute(loadTodos).then((m) => ({ default: m.TodosWorkspace })),
);
const InboxWorkspace = lazy(() =>
  trackRoute(loadInbox).then((m) => ({ default: m.InboxWorkspace })),
);
const InboxReader = lazy(() =>
  trackRoute(loadInboxReader).then((m) => ({ default: m.InboxReader })),
);
const ExtractJobsCanvas = lazy(() =>
  trackRoute(loadExtractJobs).then((m) => ({ default: m.ExtractJobsCanvas })),
);
const ReportsWorkspace = lazy(() =>
  trackRoute(loadReports).then((m) => ({ default: m.ReportsWorkspace })),
);
const SearchPage = lazy(() => trackRoute(loadSearch).then((m) => ({ default: m.SearchPage })));
const HabitsPage = lazy(() => trackRoute(loadHabits).then((m) => ({ default: m.HabitsPage })));
const DaysWorkspace = lazy(() => trackRoute(loadDays).then((m) => ({ default: m.DaysWorkspace })));
const ThreadsPage = lazy(() => trackRoute(loadThreads).then((m) => ({ default: m.ThreadsPage })));
const ActivityPage = lazy(() =>
  trackRoute(loadActivity).then((m) => ({ default: m.ActivityPage })),
);
const MemoryPage = lazy(() => trackRoute(loadMemory).then((m) => ({ default: m.MemoryPage })));
const UsagePage = lazy(() => trackRoute(loadUsage).then((m) => ({ default: m.UsagePage })));
const SettingsPage = lazy(() =>
  trackRoute(loadSettings).then((m) => ({ default: m.SettingsPage })),
);
const NotFoundPage = lazy(() =>
  trackRoute(loadNotFound).then((m) => ({ default: m.NotFoundPage })),
);

export function App() {
  const { pathname } = useLocation();
  return (
    <>
      <RouteProgress />
      <RouteErrorBoundary resetKey={pathname}>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={isDesktopHost() ? <RootEntry /> : <LandingPage />} />
            <Route path="/home" element={<Navigate to="/" replace />} />
            <Route
              path="/login"
              element={
                <GuestOnly>
                  <LoginPage />
                </GuestOnly>
              }
            />
            <Route
              path="/register"
              element={
                <GuestOnly>
                  <RegisterPage />
                </GuestOnly>
              }
            />
            <Route
              path="/onboarding"
              element={
                <RequireAuth>
                  <OnboardingPage />
                </RequireAuth>
              }
            />
            <Route
              path="/auth/extension"
              element={
                <RequireAuth>
                  <ExtensionAuthPage />
                </RequireAuth>
              }
            />
            <Route
              element={
                <RequireAuth>
                  <Shell />
                </RequireAuth>
              }
            >
              <Route path="/today" element={<TodayWorkspace />} />
              <Route path="/today/threads/:id" element={<ThreadWorkspace />} />
              <Route path="/todos" element={<Navigate to={TODOS_HOME_PATH} replace />} />
              <Route path="/todos/lists/:listId" element={<TodosWorkspace view="list" />} />
              <Route path="/todos/board" element={<TodosWorkspace view="board" />} />
              <Route path="/todos/calendar" element={<TodosWorkspace view="week" />} />
              <Route path="/inbox" element={<InboxWorkspace />}>
                <Route path="jobs" element={<ExtractJobsCanvas />} />
                <Route path=":id" element={<InboxReader />} />
              </Route>
              <Route path="/reports" element={<ReportsWorkspace />} />
              <Route path="/reports/:id" element={<ReportsWorkspace />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/library" element={<Navigate to="/search" replace />} />
              <Route path="/habits" element={<HabitsPage />} />
              <Route path="/days" element={<DaysWorkspace />} />
              <Route path="/threads" element={<ThreadsPage />} />
              <Route path="/activity" element={<ActivityPage />} />
              <Route path="/memory" element={<MemoryPage />} />
              <Route path="/usage" element={<UsagePage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </Suspense>
      </RouteErrorBoundary>
    </>
  );
}
