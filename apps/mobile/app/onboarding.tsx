import { Redirect } from 'expo-router';
import { useAuth } from '../src/auth/AuthProvider';
import { Loading } from '../src/components/Loading';
import { OnboardingHome } from '../src/features/onboarding/OnboardingHome';

export default function OnboardingScreen() {
  const auth = useAuth();
  if (!auth.ready) return <Loading />;
  if (!auth.user) return <Redirect href="/login" />;
  return <OnboardingHome />;
}
