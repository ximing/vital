import { observer, useService } from '@rabjs/react';
import type { FC, ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { HOME_PATH } from '@/copy';
import { needsOnboarding } from '@/features/onboarding';
import { AuthService } from '@/services/auth.service';

function afterAuthPath(from: string | undefined, user: Parameters<typeof needsOnboarding>[0]): string {
  if (from && from !== '/login' && from !== '/register') return from;
  return needsOnboarding(user) ? '/onboarding' : HOME_PATH;
}

export const RequireAuth: FC<{ children: ReactNode }> = observer(function RequireAuth({ children }) {
  const user = useService(AuthService).user;
  const location = useLocation();
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
});

export const GuestOnly: FC<{ children: ReactNode }> = observer(function GuestOnly({ children }) {
  const user = useService(AuthService).user;
  const location = useLocation() as { state?: { from?: string } };
  if (user) {
    return <Navigate to={afterAuthPath(location.state?.from, user)} replace />;
  }
  return <>{children}</>;
});
