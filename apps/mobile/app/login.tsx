import { Redirect } from 'expo-router';
import { useAuth } from '../src/services/auth.service';
import { Loading } from '../src/components/Loading';
import { LoginPage } from '../src/features/login';
import { needsOnboarding } from '../src/lib/onboarding';

export default function LoginScreen() {
  const auth = useAuth();
  if (!auth.ready) return <Loading />;
  if (auth.user) return <Redirect href={needsOnboarding(auth.user) ? '/onboarding' : '/'} />;
  return <LoginPage />;
}
