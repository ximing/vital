/** Shared dynamic imports for route lazy() and idle/hover warmup. One specifier, one network load. */

export function loadLanding() {
  return import('@/pages/landing');
}

export function loadLogin() {
  return import('@/pages/login');
}

export function loadRegister() {
  return import('@/pages/register');
}

export function loadOnboarding() {
  return import('@/features/onboarding/OnboardingPage');
}

export function loadExtensionAuth() {
  return import('@/pages/extension-auth');
}

export function loadShell() {
  return import('@/shell/Shell');
}

export function loadToday() {
  return import('@/features/today/TodayWorkspace');
}

export function loadThread() {
  return import('@/features/today/ThreadWorkspace');
}

export function loadTodos() {
  return import('@/features/todos/TodosWorkspace');
}

export function loadInbox() {
  return import('@/features/inbox/InboxWorkspace');
}

export function loadInboxReader() {
  return import('@/features/inbox/InboxReader');
}

export function loadExtractJobs() {
  return import('@/features/inbox/ExtractJobsCanvas');
}

export function loadReports() {
  return import('@/features/reports/ReportsWorkspace');
}

export function loadSearch() {
  return import('@/features/search/SearchPage');
}

export function loadHabits() {
  return import('@/pages/ai');
}

export function loadDays() {
  return import('@/features/days/DaysWorkspace');
}

export function loadThreads() {
  return import('@/pages/ai');
}

export function loadActivity() {
  return import('@/pages/ai');
}

export function loadMemory() {
  return import('@/pages/ai');
}

export function loadUsage() {
  return import('@/pages/ai');
}

export function loadSettings() {
  return import('@/pages/settings');
}

export function loadNotFound() {
  return import('@/pages/empty');
}

export function loadNotesEditor() {
  return import('@/features/todos/NotesEditor');
}

export function loadReportEditor() {
  return import('@/features/reports/WysiwygEditor');
}
