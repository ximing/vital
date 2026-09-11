import { Navigate, Route, Routes } from 'react-router';
import { HOME_PATH, TODOS_HOME_PATH } from '@/copy';
import { InboxReader, InboxWorkspace } from '@/features/inbox';
import { OnboardingPage } from '@/features/onboarding';
import { ReportsWorkspace } from '@/features/reports';
import { SearchPage } from '@/features/search/SearchPage';
import { ThreadWorkspace, TodayWorkspace } from '@/features/today';
import { TodosWorkspace } from '@/features/todos';
import { ExtensionAuthPage } from '@/pages/extension-auth';
import { ActivityPage, HabitsPage, MemoryPage, ThreadsPage, UsagePage } from '@/pages/ai';
import { LoginPage } from '@/pages/login';
import { NotFoundPage } from '@/pages/empty';
import { RegisterPage } from '@/pages/register';
import { SettingsPage } from '@/pages/settings';
import { GuestOnly, RequireAuth } from '@/shell/require-auth';
import { Shell } from '@/shell/Shell';

export function App() {
  return (
    <Routes>
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
        <Route path="/" element={<Navigate to={HOME_PATH} replace />} />
        <Route path="/today" element={<TodayWorkspace />} />
        <Route path="/today/threads/:id" element={<ThreadWorkspace />} />
        <Route path="/todos" element={<Navigate to={TODOS_HOME_PATH} replace />} />
        <Route path="/todos/lists/:listId" element={<TodosWorkspace view="list" />} />
        <Route path="/todos/board" element={<TodosWorkspace view="board" />} />
        <Route path="/todos/calendar" element={<TodosWorkspace view="week" />} />
        <Route path="/inbox" element={<InboxWorkspace />} />
        <Route path="/inbox/:id" element={<InboxReader />} />
        <Route path="/reports" element={<ReportsWorkspace />} />
        <Route path="/reports/:id" element={<ReportsWorkspace />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/library" element={<Navigate to="/search" replace />} />
        <Route path="/habits" element={<HabitsPage />} />
        <Route path="/threads" element={<ThreadsPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/memory" element={<MemoryPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
