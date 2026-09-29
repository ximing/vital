import { spawn } from 'node:child_process';
import { MAX_EXTRACT_HTML_BYTES } from '@vital/dto';
import { config } from '../config.js';
import { EXTRACT_USER_AGENT } from './ssrf.js';

/** First paint is often an empty shell. Keep the CLI default wait, then one longer pass. */
export const OBSCURA_WAIT_SEC = 5;
export const OBSCURA_TIMEOUT_SEC = 20;
export const OBSCURA_RETRY_WAIT_SEC = 12;
export const OBSCURA_RETRY_TIMEOUT_SEC = 25;

export type ObscuraFailureReason = 'missing' | 'failed';

export class ObscuraUnavailable extends Error {
  readonly reason: ObscuraFailureReason;

  constructor(message: string, reason: ObscuraFailureReason) {
    super(message);
    this.name = 'ObscuraUnavailable';
    this.reason = reason;
  }
}

export interface ObscuraPage {
  href: string;
  title: string;
  html: string;
}

export interface ObscuraFetchRequest {
  url: string;
  waitSec: number;
  timeoutSec: number;
}

export type ObscuraRunner = (req: ObscuraFetchRequest) => Promise<ObscuraPage>;

/** Strip hydration scripts before the HTML cap, then return the post-JS document. */
export function obscuraEvalScript(): string {
  const cap = MAX_EXTRACT_HTML_BYTES;
  return `(() => {
    for (const el of document.querySelectorAll('script, style, noscript')) el.remove();
    const root = document.documentElement;
    const html = root ? root.outerHTML : '';
    return {
      href: location.href,
      title: document.title || '',
      html: html.length > ${String(cap)} ? html.slice(0, ${String(cap)}) : html,
    };
  })()`;
}

/** Argv after the binary. Never enables private-network fetches or a proxy. */
export function obscuraArgs(url: string, waitSec: number, timeoutSec: number): string[] {
  return [
    'fetch',
    url,
    '--quiet',
    '--timeout',
    String(timeoutSec),
    '--wait',
    String(waitSec),
    '--wait-until',
    'domcontentloaded',
    '--user-agent',
    EXTRACT_USER_AGENT,
    '--eval',
    obscuraEvalScript(),
  ];
}

/**
 * Direct connection. The first pass bounds hung subresources and huge inline
 * scripts so a page whose article is already in the document can finish;
 * the longer retry gives a client-rendered page time to mount.
 */
export function obscuraProcessEnv(
  timeoutSec: number,
  waitSec: number,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source };
  delete env.http_proxy;
  delete env.https_proxy;
  delete env.all_proxy;
  delete env.HTTP_PROXY;
  delete env.HTTPS_PROXY;
  delete env.ALL_PROXY;
  delete env.OBSCURA_PROXY;
  const retry = waitSec >= OBSCURA_RETRY_WAIT_SEC;
  env.OBSCURA_NAV_TIMEOUT_MS = String(timeoutSec * 1000);
  env.OBSCURA_FETCH_TIMEOUT_MS = retry ? '12000' : '2000';
  env.OBSCURA_SCRIPT_DEADLINE_MS = retry ? '20000' : '4000';
  return env;
}

export function parseObscuraStdout(stdout: string): ObscuraPage {
  const trimmed = stdout.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new ObscuraUnavailable('obscura returned no json', 'failed');
  let value: unknown;
  try {
    value = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    throw new ObscuraUnavailable('obscura returned invalid json', 'failed');
  }
  if (typeof value !== 'object' || value === null) {
    throw new ObscuraUnavailable('obscura returned no object', 'failed');
  }
  const rec = value as Record<string, unknown>;
  if (typeof rec.href !== 'string' || typeof rec.html !== 'string') {
    throw new ObscuraUnavailable('obscura returned an incomplete page', 'failed');
  }
  return {
    href: rec.href,
    title: typeof rec.title === 'string' ? rec.title : '',
    html: rec.html,
  };
}

const STDOUT_CAP = MAX_EXTRACT_HTML_BYTES + 64 * 1024;

function spawnObscura(req: ObscuraFetchRequest): Promise<ObscuraPage> {
  const args = obscuraArgs(req.url, req.waitSec, req.timeoutSec);
  return new Promise((resolve, reject) => {
    const child = spawn(config.OBSCURA_BIN, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      env: obscuraProcessEnv(req.timeoutSec, req.waitSec),
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      const kill = setTimeout(() => {
        child.kill('SIGKILL');
      }, 1_000);
      kill.unref();
      fail(new ObscuraUnavailable('obscura timed out', 'failed'));
    }, (req.timeoutSec + 5) * 1_000);
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > STDOUT_CAP) {
        child.kill('SIGKILL');
        fail(new ObscuraUnavailable('obscura output too large', 'failed'));
        return;
      }
      chunks.push(chunk);
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      const missing = err.code === 'ENOENT';
      fail(new ObscuraUnavailable(missing ? 'obscura not found' : err.message, missing ? 'missing' : 'failed'));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new ObscuraUnavailable(`obscura exited ${code === null ? 'null' : String(code)}`, 'failed'));
        return;
      }
      try {
        resolve(parseObscuraStdout(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err instanceof Error ? err : new ObscuraUnavailable('obscura returned invalid json', 'failed'));
      }
    });
  });
}

let runnerOverride: ObscuraRunner | null = null;

/** Test seam. Do not call from product code. */
export function setObscuraRunner(next: ObscuraRunner | null): void {
  runnerOverride = next;
}

function activeRunner(): ObscuraRunner {
  if (runnerOverride !== null) return runnerOverride;
  if (process.env.NODE_ENV === 'test') {
    return () => Promise.reject(new ObscuraUnavailable('obscura disabled in tests', 'missing'));
  }
  return spawnObscura;
}

export function runObscura(req: ObscuraFetchRequest): Promise<ObscuraPage> {
  return activeRunner()(req);
}
