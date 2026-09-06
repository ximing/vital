import {
  ONBOARDING_CHECKLIST_KEYS,
  type OnboardingChecklistKey,
  type OnboardingState,
  type UserProfile,
} from '@vital/dto';
import { HOME_PATH } from '@/copy';

export const ONBOARDING_HREFS = ['/inbox', HOME_PATH, '/reports?type=weekly'] as const;

export function needsOnboarding(user: UserProfile | null | undefined): boolean {
  if (!user) return false;
  const state = user.onboarding;
  if (state.dismissed === true) return false;
  return ONBOARDING_CHECKLIST_KEYS.every((key) => state[key] !== true);
}

export function showChecklist(state: OnboardingState | undefined): boolean {
  if (!state || state.dismissed === true) return false;
  return ONBOARDING_CHECKLIST_KEYS.some((key) => state[key] !== true);
}

export function checklistHref(key: OnboardingChecklistKey): string {
  if (key === 'capturedInbox') return '/inbox';
  if (key === 'openedWeekly') return '/reports?type=weekly';
  if (key === 'pinnedTask') return '/reports';
  return HOME_PATH;
}

export function remainingCount(state: OnboardingState): number {
  return ONBOARDING_CHECKLIST_KEYS.filter((key) => state[key] !== true).length;
}
