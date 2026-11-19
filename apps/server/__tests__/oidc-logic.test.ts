import { describe, expect, it } from 'vitest';
import {
  decideEmail,
  displayNameFromClaims,
  keycloakNames,
  keycloakPasswordCredential,
  planAccountImport,
  redactOidcUrl,
  resolveOidcConfig,
  sanitizeReturnTo,
} from '../src/auth/oidc-logic.js';

const base = {
  NODE_ENV: 'production' as const,
  WEB_ORIGIN: 'https://vital.aimo.plus',
};

describe('resolveOidcConfig', () => {
  it('stays off without calling it an error when every variable is empty', () => {
    expect(resolveOidcConfig(base)).toEqual({ enabled: false, error: false, missing: [] });
  });

  it('stays off and names the missing variables when the set is partial', () => {
    const resolved = resolveOidcConfig({ ...base, OIDC_ISSUER: 'https://issuer.example/realms/one' });
    expect(resolved.enabled).toBe(false);
    if (resolved.enabled) return;
    expect(resolved.error).toBe(true);
    expect(resolved.missing).toEqual([
      'OIDC_CLIENT_ID',
      'OIDC_CLIENT_SECRET',
      'OIDC_REDIRECT_URI',
      'OIDC_AUDIENCE',
    ]);
  });

  it('rejects the occupied client id and a redirect on another origin', () => {
    const resolved = resolveOidcConfig({
      ...base,
      OIDC_ISSUER: 'https://super-agent-auth.aimo.plus/realms/aimo-plus-prod',
      OIDC_CLIENT_ID: 'super-agent-native',
      OIDC_CLIENT_SECRET: '0123456789abcdef',
      OIDC_REDIRECT_URI: 'https://other.example/api/auth/oidc/callback',
      OIDC_AUDIENCE: 'super-agent-api',
    });
    expect(resolved.enabled).toBe(false);
    if (resolved.enabled) return;
    expect(resolved.missing).toEqual(
      expect.arrayContaining(['OIDC_CLIENT_ID', 'OIDC_REDIRECT_URI', 'OIDC_AUDIENCE']),
    );
  });
});

describe('oidc helpers', () => {
  it('keeps a same-site return path and drops scheme or oidc paths', () => {
    const origin = 'https://vital.aimo.plus';
    expect(sanitizeReturnTo('/today?x=1', origin)).toBe('/today?x=1');
    expect(sanitizeReturnTo('//evil.example', origin)).toBe('/');
    expect(sanitizeReturnTo('/api/auth/oidc/start', origin)).toBe('/');
    expect(sanitizeReturnTo('https://vital.aimo.plus/today', origin)).toBe('/');
  });

  it('accepts only the agreed argon2id PHC and pads the credential', () => {
    const salt = Buffer.alloc(16, 1).toString('base64').replace(/=+$/, '');
    const hash = Buffer.alloc(32, 2).toString('base64').replace(/=+$/, '');
    const phc = `$argon2id$v=19$m=19456,t=2,p=1$${salt}$${hash}`;
    const credential = keycloakPasswordCredential(phc);
    expect(credential).not.toBeNull();
    const secret = JSON.parse(credential?.secretData ?? '{}') as { value: string; salt: string };
    expect(secret.value.endsWith('=') || secret.value.length % 4 === 0).toBe(true);
    expect(Buffer.from(secret.value, 'base64')).toHaveLength(32);
    const data = JSON.parse(credential?.credentialData ?? '{}') as {
      additionalParameters: { type: string[]; version: string[] };
    };
    expect(data.additionalParameters.type).toEqual(['id']);
    expect(data.additionalParameters.version).toEqual(['1.3']);
    expect(keycloakPasswordCredential('$argon2id$v=19$m=65536,t=3,p=4$aa$bb')).toBeNull();
  });

  it('splits a display name and skips a duplicate email group', () => {
    expect(keycloakNames('席 铭', 'a@b.c')).toEqual({ firstName: '席', lastName: '铭' });
    expect(keycloakNames('', 'wei$rd@b.c')).toEqual({ firstName: 'weird', lastName: 'weird' });
    const salt = Buffer.alloc(16, 3).toString('base64').replace(/=+$/, '');
    const hash = Buffer.alloc(32, 4).toString('base64').replace(/=+$/, '');
    const phc = `$argon2id$v=19$m=19456,t=2,p=1$${salt}$${hash}`;
    const plan = planAccountImport([
      { id: '1', email: 'A@B.c', displayName: 'A', passwordHash: phc },
      { id: '2', email: 'a@b.c', displayName: 'B', passwordHash: phc },
      { id: '3', email: 'ok@b.c', displayName: 'Ok', passwordHash: null },
      { id: '4', email: 'keep@b.c', displayName: 'Keep', passwordHash: phc },
    ]);
    expect(plan.skippedDuplicate).toBe(2);
    expect(plan.skippedHash).toBe(1);
    expect(plan.ready.map((row) => row.email)).toEqual(['keep@b.c']);
  });

  it('redacts callback query secrets and reports an email conflict', () => {
    expect(redactOidcUrl('/api/auth/oidc/callback?code=abc&state=def&ok=1')).toBe(
      '/api/auth/oidc/callback?code=[redacted]&state=[redacted]&ok=1',
    );
    expect(redactOidcUrl('/api/v1/auth/login?code=abc')).toBe('/api/v1/auth/login?code=abc');
    expect(decideEmail('A@B.c', true)).toEqual({ kind: 'conflict' });
    expect(displayNameFromClaims('  ', 'name')).toBe('name');
  });
});
