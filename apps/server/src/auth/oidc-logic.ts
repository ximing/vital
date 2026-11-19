import { createHash, timingSafeEqual } from 'node:crypto';

const REQUIRED = [
  'OIDC_ISSUER',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
  'OIDC_REDIRECT_URI',
  'OIDC_AUDIENCE',
] as const;

const ASYMMETRIC = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
] as const;

const REDACTED_QUERY = new Set(['code', 'state', 'session_state', 'login_code']);
const NAME_BANNED = new Set('<>&"\\$%!#?§;*/~|^=[]{}()'.split(''));

/** users.display_name is varchar(50). */
export const DISPLAY_NAME_MAX = 50;

export type OidcEnv = {
  NODE_ENV: 'development' | 'test' | 'production';
  WEB_ORIGIN: string;
  OIDC_ISSUER?: string | undefined;
  OIDC_CLIENT_ID?: string | undefined;
  OIDC_CLIENT_SECRET?: string | undefined;
  OIDC_REDIRECT_URI?: string | undefined;
  OIDC_AUDIENCE?: string | undefined;
  OIDC_SCOPES?: string | undefined;
};

export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  audience: string;
  scopes: string;
  issuerHost: string;
};

export type OidcResolution =
  | { enabled: true; config: OidcConfig }
  | { enabled: false; error: boolean; missing: string[] };

export type OidcErrorCode =
  | 'OIDC_STATE'
  | 'OIDC_DENIED'
  | 'OIDC_UNAVAILABLE'
  | 'OIDC_SUBJECT'
  | 'OIDC_AUDIENCE'
  | 'OIDC_EMAIL_CONFLICT'
  | 'OIDC_EMAIL_INVALID'
  | 'OIDC_IDENTITY_TAKEN'
  | 'OIDC_IDENTITY_EXISTS'
  | 'OIDC_BIND_SESSION'
  | 'RATE_LIMITED';

export type EmailDecision =
  | { kind: 'synthetic' }
  | { kind: 'invalid' }
  | { kind: 'conflict' }
  | { kind: 'use'; email: string };

export type ImportCandidate = {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string | null;
};

export type ImportReady = {
  id: string;
  email: string;
  displayName: string;
  credential: { secretData: string; credentialData: string };
  names: { firstName: string; lastName: string };
};

function filled(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function httpsUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function resolveOidcConfig(env: OidcEnv): OidcResolution {
  const values: Record<(typeof REQUIRED)[number], string | undefined> = {
    OIDC_ISSUER: env.OIDC_ISSUER,
    OIDC_CLIENT_ID: env.OIDC_CLIENT_ID,
    OIDC_CLIENT_SECRET: env.OIDC_CLIENT_SECRET,
    OIDC_REDIRECT_URI: env.OIDC_REDIRECT_URI,
    OIDC_AUDIENCE: env.OIDC_AUDIENCE,
  };
  const missing = REQUIRED.filter((name) => !filled(values[name]));
  if (missing.length === REQUIRED.length && !filled(env.OIDC_SCOPES)) {
    return { enabled: false, error: false, missing: [] };
  }
  if (missing.length > 0) return { enabled: false, error: true, missing: [...missing] };

  const issuerValue = values.OIDC_ISSUER;
  const clientId = values.OIDC_CLIENT_ID;
  const clientSecret = values.OIDC_CLIENT_SECRET;
  const redirectValue = values.OIDC_REDIRECT_URI;
  const audience = values.OIDC_AUDIENCE;
  if (!issuerValue || !clientId || !clientSecret || !redirectValue || !audience) {
    return { enabled: false, error: true, missing: [...missing] };
  }

  const problems: string[] = [];
  const issuerRaw = issuerValue.replace(/\/$/, '');
  const issuerUrl = httpsUrl(issuerRaw);
  if (!issuerUrl) problems.push('OIDC_ISSUER');

  if (clientId === 'super-agent-native') problems.push('OIDC_CLIENT_ID');
  if (clientSecret.length < 16) problems.push('OIDC_CLIENT_SECRET');
  if (audience === 'super-agent-api') problems.push('OIDC_AUDIENCE');

  let redirect: URL | null = null;
  try {
    redirect = new URL(redirectValue);
  } catch {
    redirect = null;
  }
  const origin = env.WEB_ORIGIN.replace(/\/$/, '');
  if (
    !redirect ||
    redirect.origin !== origin ||
    redirect.pathname !== '/api/auth/oidc/callback' ||
    redirect.search ||
    redirect.hash ||
    (env.NODE_ENV === 'production' && redirect.protocol !== 'https:')
  ) {
    problems.push('OIDC_REDIRECT_URI');
  }

  let scopes = 'openid profile email';
  if (filled(env.OIDC_SCOPES)) {
    const parts = env.OIDC_SCOPES.trim().split(/\s+/);
    if (
      !parts.includes('openid') ||
      !parts.includes('profile') ||
      !parts.includes('email') ||
      parts.includes('offline_access')
    ) {
      problems.push('OIDC_SCOPES');
    } else {
      scopes = parts.join(' ');
    }
  }

  if (problems.length > 0 || !issuerUrl || !redirect) {
    return { enabled: false, error: true, missing: [...new Set(problems)] };
  }
  return {
    enabled: true,
    config: {
      issuer: issuerUrl.toString().replace(/\/$/, ''),
      clientId,
      clientSecret,
      redirectUri: redirect.toString(),
      audience,
      scopes,
      issuerHost: issuerUrl.host,
    },
  };
}

export function sanitizeReturnTo(raw: string | undefined, webOrigin: string): string {
  if (!raw || raw.length > 512 || raw.includes('\\') || raw.startsWith('//')) return '/';
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return '/';
  let url: URL;
  try {
    url = new URL(raw, webOrigin);
  } catch {
    return '/';
  }
  if (url.origin !== webOrigin || url.pathname.startsWith('/api/auth/oidc')) return '/';
  return `${url.pathname}${url.search}`;
}

export function syntheticEmail(issuer: string, sub: string): string {
  const hex = createHash('sha256').update(`${issuer}\n${sub}`).digest('hex');
  return `oidc.${hex}@users.vital.invalid`;
}

export function isSyntheticEmail(email: string): boolean {
  return email.startsWith('oidc.') && email.endsWith('@users.vital.invalid');
}

function clipCodePoints(value: string, max: number): string {
  let out = '';
  let count = 0;
  for (const char of value) {
    if (count >= max) break;
    out += char;
    count += 1;
  }
  return out;
}

export function displayNameFromClaims(name: unknown, preferred: unknown): string {
  const pick = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const raw = pick(name) || pick(preferred);
  if (!raw) return '';
  return clipCodePoints(raw, DISPLAY_NAME_MAX);
}

export function allowedAlgs(listed: readonly string[] | undefined): string[] {
  if (!listed || listed.length === 0) return ['RS256'];
  return listed.filter((alg): alg is (typeof ASYMMETRIC)[number] =>
    (ASYMMETRIC as readonly string[]).includes(alg),
  );
}

export function audienceIncludes(aud: unknown, expected: string): boolean {
  if (typeof aud === 'string') return aud === expected;
  return Array.isArray(aud) && aud.some((item) => item === expected);
}

export function stateMatches(expected: string, actual: string | undefined): boolean {
  if (!actual) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function endpointAllowed(endpoint: string, issuer: string): boolean {
  let target: URL;
  let root: URL;
  try {
    target = new URL(endpoint);
    root = new URL(issuer);
  } catch {
    return false;
  }
  if (target.protocol !== 'https:' || target.host !== root.host) return false;
  const base = root.pathname.endsWith('/') ? root.pathname : `${root.pathname}/`;
  return target.pathname === root.pathname || target.pathname.startsWith(base);
}

export function decideEmail(raw: unknown, emailTaken: boolean): EmailDecision {
  if (typeof raw !== 'string' || raw.trim().length === 0) return { kind: 'synthetic' };
  const email = raw.trim().toLowerCase();
  if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { kind: 'invalid' };
  if (emailTaken) return { kind: 'conflict' };
  return { kind: 'use', email };
}

export function idTokenAccepts(input: {
  aud: unknown;
  clientId: string;
  nonce: unknown;
  expectedNonce: string;
  sub: unknown;
  accessSub: string;
}): OidcErrorCode | null {
  if (!audienceIncludes(input.aud, input.clientId)) return 'OIDC_AUDIENCE';
  if (typeof input.nonce !== 'string' || !stateMatches(input.expectedNonce, input.nonce)) {
    return 'OIDC_STATE';
  }
  if (typeof input.sub !== 'string' || input.sub.length === 0 || input.sub !== input.accessSub) {
    return 'OIDC_SUBJECT';
  }
  return null;
}

export function keycloakPasswordCredential(
  phc: string,
): { secretData: string; credentialData: string } | null {
  const parts = phc.split('$');
  if (
    parts.length !== 6 ||
    parts[1] !== 'argon2id' ||
    parts[2] !== 'v=19' ||
    parts[3] !== 'm=19456,t=2,p=1'
  ) {
    return null;
  }
  const saltRaw = parts[4] ?? '';
  const hashRaw = parts[5] ?? '';
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(saltRaw) || !/^[A-Za-z0-9+/]+={0,2}$/.test(hashRaw)) {
    return null;
  }
  const salt = Buffer.from(saltRaw, 'base64');
  const hash = Buffer.from(hashRaw, 'base64');
  if (salt.length === 0 || hash.length !== 32) return null;
  return {
    secretData: JSON.stringify({
      value: hash.toString('base64'),
      salt: salt.toString('base64'),
      additionalParameters: {},
    }),
    credentialData: JSON.stringify({
      hashIterations: 2,
      algorithm: 'argon2',
      additionalParameters: {
        hashLength: ['32'],
        memory: ['19456'],
        type: ['id'],
        version: ['1.3'],
        parallelism: ['1'],
      },
    }),
  };
}

function clipName(value: string): string {
  return clipCodePoints(value, 64);
}

function cleanName(value: string): string {
  let out = '';
  for (const char of value) {
    if (NAME_BANNED.has(char) || char.charCodeAt(0) < 32) continue;
    out += char;
  }
  return out.trim();
}

export function keycloakNames(
  displayName: string | null | undefined,
  email: string,
): { firstName: string; lastName: string } {
  const parts = (displayName ?? '').trim().split(/\s+/).filter((part) => part.length > 0);
  if (parts.length >= 2) {
    const lastName = clipName(cleanName(parts[parts.length - 1] ?? ''));
    const firstName = clipName(cleanName(parts.slice(0, -1).join(' ')));
    if (firstName.length > 0 && lastName.length > 0) return { firstName, lastName };
  }
  if (parts.length === 1) {
    const name = clipName(cleanName(parts[0] ?? ''));
    if (name.length > 0) return { firstName: name, lastName: name };
  }
  const local = email.split('@')[0] ?? '';
  const cleaned = clipName(cleanName(local));
  const name = cleaned.length > 0 ? cleaned : '用户';
  return { firstName: name, lastName: name };
}

/** Rows that fold to the same email are skipped as a group. Other hashes are skipped. */
export function planAccountImport(rows: readonly ImportCandidate[]): {
  ready: ImportReady[];
  skippedDuplicate: number;
  skippedHash: number;
} {
  const groups = new Map<string, ImportCandidate[]>();
  for (const row of rows) {
    const email = row.email.trim().toLowerCase();
    const list = groups.get(email) ?? [];
    list.push(row);
    groups.set(email, list);
  }
  const ready: ImportReady[] = [];
  let skippedDuplicate = 0;
  let skippedHash = 0;
  for (const [email, group] of groups) {
    if (group.length !== 1) {
      skippedDuplicate += group.length;
      continue;
    }
    const row = group[0];
    if (!row) continue;
    const credential = row.passwordHash ? keycloakPasswordCredential(row.passwordHash) : null;
    if (!credential) {
      skippedHash += 1;
      continue;
    }
    ready.push({
      id: row.id,
      email,
      displayName: row.displayName,
      credential,
      names: keycloakNames(row.displayName, email),
    });
  }
  return { ready, skippedDuplicate, skippedHash };
}

export function redactOidcUrl(url: string): string {
  const path = url.split('?')[0] ?? url;
  if (!path.startsWith('/api/auth/oidc')) return url;
  if (!url.includes('?')) return url;
  const query = url.slice(path.length + 1);
  const next = query
    .split('&')
    .filter((part) => part.length > 0)
    .map((part) => {
      const eq = part.indexOf('=');
      const key = decodeURIComponent(eq === -1 ? part : part.slice(0, eq));
      if (!REDACTED_QUERY.has(key)) return part;
      return `${eq === -1 ? part : part.slice(0, eq)}=[redacted]`;
    })
    .join('&');
  return next.length > 0 ? `${path}?${next}` : path;
}
