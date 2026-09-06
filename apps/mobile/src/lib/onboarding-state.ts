import {
  ONBOARDING_CHECKLIST_KEYS,
  type OnboardingChecklistKey,
  type OnboardingState,
  type UserProfile,
} from '@vital/dto';

export function needsOnboarding(user: UserProfile | null | undefined): boolean {
  if (!user) return false;
  if (user.onboarding.dismissed === true) return false;
  return ONBOARDING_CHECKLIST_KEYS.every((key) => user.onboarding[key] !== true);
}

export function showChecklist(state: OnboardingState | undefined): boolean {
  if (!state || state.dismissed === true) return false;
  return ONBOARDING_CHECKLIST_KEYS.some((key) => state[key] !== true);
}

export function checklistHref(key: OnboardingChecklistKey): string {
  if (key === 'capturedInbox') return '/inbox';
  if (key === 'openedWeekly') return '/reports';
  if (key === 'pinnedTask') return '/reports';
  return '/';
}
