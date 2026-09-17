import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { TODOS_HOME_PATH } from '@/routes';
import { isTauriRuntime } from '@/api/client';
import { GuestOnly, RequireAuth, RootEntry } from '@/shell/require-auth';
import { RouteFallback } from '@/shell/route-fallback';

const LandingPage = lazy(() =>
  import('@/pages/landing').then((m) => ({ default: m.LandingPage })),
);
const LoginPage = lazy(() => import('@/pages/login').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() =>
  import('@/pages/register').then((m) => ({ default: m.RegisterPage })),
);
const OnboardingPage = lazy(() =>
  import('@/features/onboarding/OnboardingPage').then((m) => ({ default: m.OnboardingPage })),
);
const ExtensionAuthPage = lazy(() =>
  import('@/pages/extension-auth').then((m) => ({ default: m.ExtensionAuthPage })),
);
const Shell = lazy(() => import('@/shell/Shell').then((m) => ({ default: m.Shell })));
const TodayWorkspace = lazy(() =>
  import('@/features/today/TodayWorkspace').then((m) => ({ default: m.TodayWorkspace })),
);
const ThreadWorkspace = lazy(() =>
  import('@/features/today/ThreadWorkspace').then((m) => ({ default: m.ThreadWorkspace })),
);
const TodosWorkspace = lazy(() =>
  import('@/features/todos/TodosWorkspace').then((m) => ({ default: m.TodosWorkspace })),
);
const InboxWorkspace = lazy(() =>
  import('@/features/inbox/InboxWorkspace').then((m) => ({ default: m.InboxWorkspace })),
);
const InboxReader = lazy(() =>
  import('@/features/inbox/InboxReader').then((m) => ({ default: m.InboxReader })),
);
const ReportsWorkspace = lazy(() =>
  import('@/features/reports/ReportsWorkspace').then((m) => ({ default: m.ReportsWorkspace })),
);
const SearchPage = lazy(() =>
  import('@/features/search/SearchPage').then((m) => ({ default: m.SearchPage })),
);
const HabitsPage = lazy(() => import('@/pages/ai').then((m) => ({ default: m.HabitsPage })));
const DaysWorkspace = lazy(() =>
  import('@/features/days/DaysWorkspace').then((m) => ({ default: m.DaysWorkspace })),
);
const ThreadsPage = lazy(() => import('@/pages/ai').then((m) => ({ default: m.ThreadsPage })));
const ActivityPage = lazy(() => import('@/pages/ai').then((m) => ({ default: m.ActivityPage })));
const MemoryPage = lazy(() => import('@/pages/ai').then((m) => ({ default: m.MemoryPage })));
const UsagePage = lazy(() => import('@/pages/ai').then((m) => ({ default: m.UsagePage })));
const SettingsPage = lazy(() =>
  import('@/pages/settings').then((m) => ({ default: m.SettingsPage })),
);
const NotFoundPage = lazy(() =>
  import('@/pages/empty').then((m) => ({ default: m.NotFoundPage })),
);

export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={isTauriRuntime() ? <RootEntry /> : <LandingPage />} />
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
  );
}
