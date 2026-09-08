import { chromeExtensionIdSchema } from '@vital/dto';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { AuthLayout } from '@/pages/auth-layout';
import { client } from '@/api/client';
import { Banner } from '@/ui/banner';

type Phase = 'missing' | 'connecting' | 'connected' | 'failed';

interface ChromeRuntime {
  lastError?: { message: string };
  sendMessage: (
    extensionId: string,
    message: unknown,
    responseCallback?: (response: unknown) => void,
  ) => void;
}

function chromeRuntime(): ChromeRuntime | undefined {
  const chromeApi = (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome;
  return chromeApi?.runtime;
}

function sendToExtension(
  extensionId: string,
  code: string,
): Promise<{ ok: boolean; error?: string }> {
  const runtime = chromeRuntime();
  if (runtime === undefined) {
    return Promise.resolve({ ok: false, error: t.auth.extensionNoRuntime });
  }
  return new Promise((resolve) => {
    runtime.sendMessage(extensionId, { type: 'vital-extension-auth', code }, (response) => {
      if (runtime.lastError) {
        resolve({ ok: false, error: runtime.lastError.message });
        return;
      }
      if (typeof response === 'object' && response !== null && 'ok' in response) {
        resolve(response as { ok: boolean; error?: string });
        return;
      }
      resolve({ ok: false, error: t.auth.extensionFailed });
    });
  });
}

export function ExtensionAuthPage() {
  const [params] = useSearchParams();
  const parsed = chromeExtensionIdSchema.safeParse(params.get('id') ?? '');
  const extensionId = parsed.success ? parsed.data : null;
  const [phase, setPhase] = useState<Phase>(extensionId === null ? 'missing' : 'connecting');
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (extensionId === null || ran.current) return;
    ran.current = true;
    void client
      .createExtensionAuthCode()
      .then(async (issued) => {
        const handed = await sendToExtension(extensionId, issued.code);
        if (handed.ok) {
          setPhase('connected');
          return;
        }
        window.location.assign(
          `chrome-extension://${extensionId}/popup.html?code=${encodeURIComponent(issued.code)}`,
        );
      })
      .catch((err: unknown) => {
        setError(humanError(err));
        setPhase('failed');
      });
  }, [extensionId]);

  const kicker =
    phase === 'connected'
      ? t.auth.extensionConnected
      : phase === 'missing'
        ? t.auth.extensionMissingId
        : t.auth.extensionKicker;

  return (
    <AuthLayout title={t.auth.extensionTitle} kicker={kicker}>
      {phase === 'connecting' ? (
        <p className="text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-muted">
          {t.auth.extensionConnecting}
        </p>
      ) : null}
      {phase === 'connected' ? (
        <p className="text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-muted">
          {t.auth.extensionConnectedHint}
        </p>
      ) : null}
      {phase === 'missing' ? <Banner>{t.auth.extensionMissingId}</Banner> : null}
      {phase === 'failed' && error !== null ? <Banner>{error}</Banner> : null}
    </AuthLayout>
  );
}
