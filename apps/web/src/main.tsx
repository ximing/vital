import { QueryClientProvider } from '@tanstack/react-query';
import { observer, RSRoot, useService } from '@rabjs/react';
import { setupWindowRootContainer } from '@rabjs/devtools';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from '@/App';
import { t } from '@/copy';
import { subscribeSystemTheme } from '@/lib/theme';
import { startSync, stopSync } from '@/features/sync/sync-engine';
import { AuthService } from '@/services/auth.service';
import { appQueryClient } from '@/services/query.service';
import { registerVitalServices } from '@/services/register';
import { Button } from '@/ui/button';
import { VitalMark } from '@/shell/VitalMark';
import '@/styles/app.css';

registerVitalServices();
setupWindowRootContainer();

const BootScreen = observer(function BootScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas text-fg">
      <VitalMark className="pulse-mark h-12 w-12 text-accent" />
      <p className="mt-4 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
        {t.boot.label}
      </p>
    </div>
  );
});

const UnreachableScreen = observer(function UnreachableScreen() {
  const auth = useService(AuthService);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas text-fg">
      <VitalMark className="h-12 w-12 text-accent" />
      <p className="mt-4 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
        {t.boot.unreachable}
      </p>
      <Button className="mt-4" onClick={() => void auth.retryBoot()}>
        {t.boot.retry}
      </Button>
    </div>
  );
});

const Root = observer(function Root() {
  const auth = useService(AuthService);
  const status = auth.status;
  const userId = auth.user?.id ?? null;

  useEffect(() => {
    void auth.boot();
  }, [auth]);

  useEffect(() => subscribeSystemTheme(), []);

  useEffect(() => {
    if (status !== 'ready' || userId === null) {
      stopSync();
      return;
    }
    startSync(appQueryClient);
    return () => stopSync();
  }, [status, userId]);

  if (status === 'booting') return <BootScreen />;
  if (status === 'unavailable') return <UnreachableScreen />;
  return <App />;
});

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <RSRoot>
        <QueryClientProvider client={appQueryClient}>
          <BrowserRouter>
            <Root />
          </BrowserRouter>
        </QueryClientProvider>
      </RSRoot>
    </StrictMode>,
  );
}
