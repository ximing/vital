import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from '@/App';
import { t } from '@/copy';
import { subscribeSystemTheme } from '@/lib/theme';
import { VitalMark } from '@/shell/VitalMark';
import { useAuthStore } from '@/state/auth-store';
import '@/styles/app.css';

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
  const status = useAuthStore((s) => s.status);
  const boot = useAuthStore((s) => s.boot);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => subscribeSystemTheme(), []);

  if (status === 'booting') return <BootScreen />;
  return <App />;
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Root />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}
