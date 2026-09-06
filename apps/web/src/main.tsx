import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RSRoot } from '@rabjs/react';
import { setupWindowRootContainer } from '@rabjs/devtools';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from '@/App';
import { t } from '@/copy';
import { subscribeSystemTheme } from '@/lib/theme';
import { authService, useAuth } from '@/services/auth.service';
import { registerVitalServices } from '@/services/register';
import { VitalMark } from '@/shell/VitalMark';
import '@/styles/app.css';

registerVitalServices();
setupWindowRootContainer();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true },
  },
});

function BootScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas text-fg">
      <VitalMark className="pulse-mark h-12 w-12 text-accent" />
      <p className="mt-4 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
        {t.boot.label}
      </p>
    </div>
  );
}

function Root() {
  const status = useAuth((s) => s.status);

  useEffect(() => {
    void authService().boot();
  }, []);

  useEffect(() => subscribeSystemTheme(), []);

  if (status === 'booting') return <BootScreen />;
  return <App />;
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <RSRoot>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Root />
          </BrowserRouter>
        </QueryClientProvider>
      </RSRoot>
    </StrictMode>,
  );
}
