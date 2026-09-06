import type { OnboardingState, UpdateOnboardingInput } from '@vital/dto';
import { client } from '@/api/client';
import { useAuthStore } from '@/state/auth-store';

function needed(state: OnboardingState, input: UpdateOnboardingInput): boolean {
  for (const [key, value] of Object.entries(input) as [keyof UpdateOnboardingInput, boolean | undefined][]) {
    if (value === undefined) continue;
    if (state[key] !== value) return true;
  }
  return false;
}

export async function markOnboarding(input: UpdateOnboardingInput): Promise<void> {
  const user = useAuthStore.getState().user;
  if (!user || !needed(user.onboarding, input)) return;
  try {
    const next = await client.updateOnboarding(input);
    if (next && typeof next.id === 'string') useAuthStore.getState().setUser(next);
  } catch {
    // Checklist is best-effort.
  }
}
