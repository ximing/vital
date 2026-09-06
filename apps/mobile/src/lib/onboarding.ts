import type { OnboardingState, UpdateOnboardingInput, UserProfile } from '@vital/dto';
import { client } from './api';

export { checklistHref, needsOnboarding, showChecklist } from './onboarding-state';

function needed(state: OnboardingState, input: UpdateOnboardingInput): boolean {
  const entries = Object.entries(input) as [keyof UpdateOnboardingInput, boolean | undefined][];
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    if (state[key] !== value) return true;
  }
  return false;
}

export async function markOnboarding(
  user: UserProfile | null,
  refreshUser: (next: UserProfile) => void,
  input: UpdateOnboardingInput,
): Promise<void> {
  if (!user || !needed(user.onboarding, input)) return;
  try {
    const next = await client.updateOnboarding(input);
    if (next && typeof next.id === 'string') refreshUser(next);
  } catch {
    // Checklist is best-effort.
  }
}
