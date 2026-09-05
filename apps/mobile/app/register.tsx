import { Redirect } from 'expo-router';
import { useAuth } from '../src/auth/AuthProvider';
import { Loading } from '../src/components/Loading';
import { RegisterPage } from '../src/features/register';

export default function RegisterScreen() {
  const auth = useAuth();
  if (!auth.ready) return <Loading />;
  if (auth.user) return <Redirect href="/" />;
  return <RegisterPage />;
}
