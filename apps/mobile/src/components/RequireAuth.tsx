import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from '../auth/AuthProvider';
import { Loading } from './Loading';

export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (!auth.ready) return <Loading />;
  if (!auth.user) return <Redirect href="/login" />;
  return <>{children}</>;
}
