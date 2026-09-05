import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { HOME_PATH } from '@/copy';
import { useAuthStore } from '@/state/auth-store';

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
    return <Navigate to={location.state?.from ?? HOME_PATH} replace />;
  }
  return <>{children}</>;
}
