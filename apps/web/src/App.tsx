import { Navigate, Route, Routes } from 'react-router';
import { HOME_PATH } from '@/copy';
import { LoginPage } from '@/pages/login';
import {
  BoardPage,
  CalendarPage,
  InboxPage,
  InboxReaderPage,
  LibraryPage,
  NotFoundPage,
  OnboardingPage,
  ReportEditorPage,
  ReportsPage,
  SearchPage,
  TodoListPage,
  TodosPage,
} from '@/pages/empty';
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
        <Route path="/todos" element={<TodosPage />} />
        <Route path="/todos/lists/:listId" element={<TodoListPage />} />
        <Route path="/todos/board" element={<BoardPage />} />
        <Route path="/todos/calendar" element={<CalendarPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/inbox/:id" element={<InboxReaderPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/reports/:id" element={<ReportEditorPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
