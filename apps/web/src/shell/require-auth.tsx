import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { HOME_PATH } from '@/copy';
import { needsOnboarding } from '@/features/onboarding';
import { useAuthStore } from '@/state/auth-store';

function afterAuthPath(from: string | undefined, user: Parameters<typeof needsOnboarding>[0]): string {
  if (from && from !== '/login' && from !== '/register') return from;
  return needsOnboarding(user) ? '/onboarding' : HOME_PATH;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

export function GuestOnly({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const location = useLocation() as { state?: { from?: string } };
  if (user) {
    return <Navigate to={afterAuthPath(location.state?.from, user)} replace />;
  }
  return <>{children}</>;
}
