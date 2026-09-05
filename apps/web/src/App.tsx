import { Navigate, Route, Routes } from 'react-router';
import { HOME_PATH } from '@/copy';
import { InboxReader, InboxWorkspace } from '@/features/inbox';
import { ReportsWorkspace } from '@/features/reports';
import { TodosWorkspace } from '@/features/todos';
import { LoginPage } from '@/pages/login';
import { LibraryPage, NotFoundPage, OnboardingPage, SearchPage } from '@/pages/empty';
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
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to={HOME_PATH} replace />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/todos" element={<Navigate to={HOME_PATH} replace />} />
        <Route path="/todos/lists/:listId" element={<TodosWorkspace view="list" />} />
        <Route path="/todos/board" element={<TodosWorkspace view="board" />} />
        <Route path="/todos/calendar" element={<TodosWorkspace view="week" />} />
        <Route path="/inbox" element={<InboxWorkspace />} />
        <Route path="/inbox/:id" element={<InboxReader />} />
        <Route path="/reports" element={<ReportsWorkspace />} />
        <Route path="/reports/:id" element={<ReportsWorkspace />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
