import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { planAccountImport, type ImportCandidate } from './oidc-logic.js';

const PRODUCTION_ISSUER = 'https://super-agent-auth.aimo.plus/realms/aimo-plus-prod';
const CLIENT_ID = 'vital';
const AUDIENCE = 'vital-api';
const ATTR = 'vital_user_id';
const MAPPER = 'vital-api-audience';

type KcUser = {
  id?: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  attributes?: Record<string, string[] | undefined>;
  credentials?: unknown;
};

type ProfileAttribute = {
  name?: string;
  displayName?: string;
  permissions?: { view?: string[]; edit?: string[] };
  multivalued?: boolean;
  validations?: { length?: { max?: number } };
};

type Profile = {
  attributes?: ProfileAttribute[];
  groups?: unknown[];
  unmanagedAttributePolicy?: string;
};

type ClientRep = {
  id?: string;
  protocol?: string;
  name?: string;
  clientId?: string;
  publicClient?: boolean;
  clientAuthenticatorType?: string;
  standardFlowEnabled?: boolean;
  implicitFlowEnabled?: boolean;
  directAccessGrantsEnabled?: boolean;
  serviceAccountsEnabled?: boolean;
  redirectUris?: string[];
  webOrigins?: string[];
  attributes?: Record<string, string>;
  defaultClientScopes?: string[];
  optionalClientScopes?: string[];
  protocolMappers?: unknown;
  secret?: string;
};

type MapperRep = {
  id?: string;
  name?: string;
  protocol?: string;
  protocolMapper?: string;
  config?: Record<string, string>;
};

type MappingRow = { id: string; email: string; sub: string; action: 'created' | 'linked' };

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) fail(`missing ${name}`);
  return value;
}

function issuer(): string {
  const value = requiredEnv('OIDC_ISSUER').replace(/\/$/, '');
  if (value !== PRODUCTION_ISSUER) fail('issuer must be aimo-plus-prod');
  return value;
}

function realmOf(value: string): { origin: string; realm: string } {
  const url = new URL(value);
  const parts = url.pathname.split('/').filter((part) => part.length > 0);
  const realm = parts[0] === 'realms' ? parts[1] : undefined;
  if (!realm) fail('issuer realm');
  return { origin: url.origin, realm };
}

async function adminToken(origin: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username: requiredEnv('OIDC_ADMIN_USER'),
    password: requiredEnv('OIDC_ADMIN_PASSWORD'),
  });
  const response = await fetch(`${origin}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) fail('admin token');
  const json = (await response.json()) as { access_token?: string };
  if (!json.access_token) fail('admin token');
  return json.access_token;
}

type AdminResponse = { status: number; json: unknown; location: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function adminApi(origin: string, realm: string, token: string) {
  return async function request(path: string, init: RequestInit = {}): Promise<AdminResponse> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`${origin}/admin/realms/${encodeURIComponent(realm)}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body ?? null,
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    const json: unknown = text.length > 0 ? (JSON.parse(text) as unknown) : undefined;
    return { status: response.status, json, location: response.headers.get('location') ?? '' };
  };
}

function attrValue(user: KcUser): string | null {
  const values = user.attributes?.[ATTR];
  if (!values || values.length === 0) return null;
  const first = values[0]?.trim() ?? '';
  return first.length > 0 ? first : null;
}

function subFromLocation(location: string): string | null {
  const sub = location.replace(/\/$/, '').split('/').pop() ?? '';
  return /^[0-9a-f-]{36}$/i.test(sub) ? sub : null;
}

function asProfile(value: unknown): Profile | null {
  if (!isRecord(value)) return null;
  return value;
}

async function declareProfile(request: ReturnType<typeof adminApi>): Promise<void> {
  const current = await request('/users/profile');
  const profile = asProfile(current.json);
  if (current.status !== 200 || !profile) fail('profile read');
  const attributes = Array.isArray(profile.attributes) ? profile.attributes : [];
  if (attributes.some((item) => item.name === ATTR)) {
    console.error('profile=present');
    return;
  }
  const next: Profile = {
    ...profile,
    attributes: [
      ...attributes,
      {
        name: ATTR,
        displayName: ATTR,
        permissions: { view: ['admin'], edit: ['admin'] },
        multivalued: false,
        validations: { length: { max: 36 } },
      },
    ],
  };
  const saved = await request('/users/profile', { method: 'PUT', body: JSON.stringify(next) });
  if (saved.status !== 200 && saved.status !== 204) fail('profile write');
  const again = asProfile((await request('/users/profile')).json);
  const againAttributes = again?.attributes ?? [];
  if (!againAttributes.some((item) => item.name === ATTR)) fail('profile missing after write');
  if (
    !againAttributes.some((item) => item.name === 'inwit_user_id') &&
    attributes.some((item) => item.name === 'inwit_user_id')
  ) {
    fail('profile dropped inwit_user_id');
  }
  console.error('profile=declared');
}

async function passwordStillThere(request: ReturnType<typeof adminApi>, sub: string): Promise<boolean> {
  const creds = await request(`/users/${encodeURIComponent(sub)}/credentials`);
  if (creds.status !== 200 || !Array.isArray(creds.json)) return false;
  return creds.json.some((item) => isRecord(item) && item.type === 'password');
}

async function readUser(request: ReturnType<typeof adminApi>, sub: string): Promise<KcUser | null> {
  const row = await request(`/users/${encodeURIComponent(sub)}`);
  if (row.status !== 200 || !isRecord(row.json)) return null;
  return row.json;
}

async function usersByEmail(request: ReturnType<typeof adminApi>, email: string): Promise<KcUser[]> {
  const query = new URLSearchParams({ email, exact: 'true' });
  const listed = await request(`/users?${query}`);
  if (listed.status !== 200 || !Array.isArray(listed.json)) fail('user lookup');
  return listed.json.filter((row): row is KcUser => isRecord(row) && row.email?.toString().trim().toLowerCase() === email);
}

async function importUsers(): Promise<void> {
  if (process.env.PG_DATABASE === 'aimo_oidc') fail('refusing database');
  const value = issuer();
  const { origin, realm } = realmOf(value);
  const token = await adminToken(origin);
  const request = adminApi(origin, realm, token);
  const pool = new pg.Pool({
    host: requiredEnv('PG_HOST'),
    port: Number(requiredEnv('PG_PORT')),
    user: requiredEnv('PG_USER'),
    password: requiredEnv('PG_PASSWORD'),
    database: requiredEnv('PG_DATABASE'),
    ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  const counts = {
    created: 0,
    linked: 0,
    skippedDuplicate: 0,
    skippedHash: 0,
    skippedAttribute: 0,
    skippedIdentity: 0,
    failed: 0,
  };
  const mapping: MappingRow[] = [];
  try {
    const selected = await pool.query<{
      id: string;
      email: string;
      display_name: string;
      password_hash: string | null;
    }>('select id, email, display_name, password_hash from users');
    const candidates: ImportCandidate[] = selected.rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      passwordHash: row.password_hash,
    }));
    const plan = planAccountImport(candidates);
    counts.skippedDuplicate = plan.skippedDuplicate;
    counts.skippedHash = plan.skippedHash;
    for (const row of plan.ready) {
      try {
        const outcome = await importOne(request, pool, value, row);
        if (outcome.kind === 'skip') {
          if (outcome.reason === 'attribute') counts.skippedAttribute += 1;
          else counts.skippedIdentity += 1;
          continue;
        }
        if (outcome.kind === 'failed') {
          counts.failed += 1;
          continue;
        }
        counts[outcome.action] += 1;
        mapping.push({ id: row.id, email: row.email, sub: outcome.sub, action: outcome.action });
      } catch {
        counts.failed += 1;
      }
    }
  } finally {
    await pool.end();
  }
  process.stdout.write(`${JSON.stringify(mapping)}\n`);
  console.error(
    `created=${String(counts.created)} linked=${String(counts.linked)} skippedDuplicate=${String(counts.skippedDuplicate)} skippedHash=${String(counts.skippedHash)} skippedAttribute=${String(counts.skippedAttribute)} skippedIdentity=${String(counts.skippedIdentity)} failed=${String(counts.failed)}`,
  );
}

async function importOne(
  request: ReturnType<typeof adminApi>,
  pool: pg.Pool,
  value: string,
  row: ReturnType<typeof planAccountImport>['ready'][number],
): Promise<
  | { kind: 'ok'; action: 'created' | 'linked'; sub: string }
  | { kind: 'skip'; reason: 'attribute' | 'identity' }
  | { kind: 'failed' }
> {
  let matches = await usersByEmail(request, row.email);
  let action: 'created' | 'linked' = 'linked';
  let sub = matches.length === 1 ? matches[0]?.id : undefined;
  if (matches.length === 0) {
    const created = await request('/users', {
      method: 'POST',
      body: JSON.stringify({
        username: row.email,
        email: row.email,
        emailVerified: true,
        enabled: true,
        firstName: row.names.firstName,
        lastName: row.names.lastName,
        attributes: { [ATTR]: [row.id] },
        credentials: [
          {
            type: 'password',
            temporary: false,
            secretData: row.credential.secretData,
            credentialData: row.credential.credentialData,
          },
        ],
      }),
    });
    if (created.status === 409) {
      matches = await usersByEmail(request, row.email);
      sub = matches.length === 1 ? matches[0]?.id : undefined;
    } else if (created.status !== 201) {
      return { kind: 'failed' };
    } else {
      sub = subFromLocation(created.location) ?? undefined;
      action = 'created';
    }
  } else if (matches.length > 1) {
    return { kind: 'failed' };
  }
  if (!sub) return { kind: 'failed' };
  const full = await readUser(request, sub);
  if (!full) return { kind: 'failed' };
  const current = attrValue(full);
  if (action === 'linked') {
    if (current && current !== row.id) return { kind: 'skip', reason: 'attribute' };
    if (!current) {
      const attributes = { ...(full.attributes ?? {}), [ATTR]: [row.id] };
      const body: KcUser = { ...full, attributes };
      delete body.credentials;
      const updated = await request(`/users/${encodeURIComponent(sub)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      if (updated.status !== 204 && updated.status !== 200) return { kind: 'failed' };
    }
  }
  const checked = await readUser(request, sub);
  if (attrValue(checked ?? {}) !== row.id) return { kind: 'failed' };
  if (!(await passwordStillThere(request, sub))) return { kind: 'failed' };
  const saved = await saveIdentity(pool, value, row.id, sub);
  if (saved === 'conflict') return { kind: 'skip', reason: 'identity' };
  return { kind: 'ok', action, sub };
}

async function saveIdentity(
  pool: pg.Pool,
  value: string,
  userId: string,
  sub: string,
): Promise<'ok' | 'conflict'> {
  const existing = await pool.query<{ user_id: string; sub: string }>(
    'select user_id, sub from oidc_identities where issuer = $1 and (user_id = $2 or sub = $3)',
    [value, userId, sub],
  );
  if (existing.rows.length === 0) {
    await pool.query(
      'insert into oidc_identities (id, user_id, issuer, sub, created_at, updated_at) values ($1, $2, $3, $4, now(), now())',
      [randomUUID(), userId, value, sub],
    );
    return 'ok';
  }
  const same = existing.rows.every((item) => item.user_id === userId && item.sub === sub);
  return same ? 'ok' : 'conflict';
}

async function alignClient(): Promise<void> {
  const value = issuer();
  const redirectUri = requiredEnv('OIDC_REDIRECT_URI');
  const webOrigin = requiredEnv('WEB_ORIGIN').replace(/\/$/, '');
  const secretFile = requiredEnv('OIDC_SECRET_FILE');
  if (new URL(redirectUri).origin !== webOrigin || new URL(redirectUri).pathname !== '/api/auth/oidc/callback') {
    fail('redirect uri');
  }
  const { origin, realm } = realmOf(value);
  const token = await adminToken(origin);
  const request = adminApi(origin, realm, token);
  const scopes = await request('/client-scopes');
  if (scopes.status !== 200 || !Array.isArray(scopes.json)) fail('client scopes');
  const names = new Set(
    scopes.json
      .map((item) => (isRecord(item) && typeof item.name === 'string' ? item.name : ''))
      .filter((name) => name.length > 0),
  );
  for (const name of ['basic', 'profile', 'email']) {
    if (!names.has(name)) fail(`missing scope ${name}`);
  }
  const found = await request(`/clients?clientId=${encodeURIComponent(CLIENT_ID)}`);
  if (found.status !== 200 || !Array.isArray(found.json)) fail('client lookup');
  const client = found.json.find(
    (item): item is ClientRep => isRecord(item) && item.clientId === CLIENT_ID,
  );
  let clientUuid = client?.id;
  if (!clientUuid) {
    const secret = randomBytes(32).toString('base64url');
    const created = await request('/clients', {
      method: 'POST',
      body: JSON.stringify(clientBody(redirectUri, webOrigin, names, secret)),
    });
    if (created.status !== 201) fail('client create');
    clientUuid = subFromLocation(created.location) ?? undefined;
    if (!clientUuid) fail('client id');
  } else {
    const full = await request(`/clients/${encodeURIComponent(clientUuid)}`);
    if (full.status !== 200 || !isRecord(full.json)) fail('client read');
    const fullClient = full.json as ClientRep;
    const body = clientBody(redirectUri, webOrigin, names);
    const defaults = new Set([...(fullClient.defaultClientScopes ?? []), ...(body.defaultClientScopes ?? [])]);
    defaults.delete('offline_access');
    const next = {
      ...fullClient,
      ...body,
      attributes: { ...(fullClient.attributes ?? {}), ...(body.attributes ?? {}) },
      defaultClientScopes: [...defaults],
      id: clientUuid,
      clientId: CLIENT_ID,
    };
    delete next.secret;
    const saved = await request(`/clients/${encodeURIComponent(clientUuid)}`, {
      method: 'PUT',
      body: JSON.stringify(next),
    });
    if (saved.status !== 204 && saved.status !== 200) fail('client update');
  }
  await ensureMapper(request, clientUuid);
  const secret = await request(`/clients/${encodeURIComponent(clientUuid)}/client-secret`);
  const secretValue = isRecord(secret.json) && typeof secret.json.value === 'string' ? secret.json.value : '';
  if (secret.status !== 200 || secretValue.length < 16) fail('client secret');
  writeFileSync(secretFile, `${secretValue}\n`, { mode: 0o600 });
  chmodSync(secretFile, 0o600);
  console.error('client=aligned');
}

function clientBody(
  redirectUri: string,
  webOrigin: string,
  names: Set<string>,
  secret?: string,
): ClientRep {
  const defaults = ['basic', 'profile', 'email', 'roles', 'web-origins', 'acr'].filter((name) => names.has(name));
  const optional = ['address', 'phone', 'microprofile-jwt'].filter((name) => names.has(name));
  return {
    clientId: CLIENT_ID,
    name: 'Vital',
    protocol: 'openid-connect',
    publicClient: false,
    clientAuthenticatorType: 'client-secret',
    ...(secret ? { secret } : {}),
    standardFlowEnabled: true,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: false,
    redirectUris: [redirectUri],
    webOrigins: [webOrigin],
    attributes: { 'pkce.code.challenge.method': 'S256' },
    defaultClientScopes: defaults,
    optionalClientScopes: optional,
  };
}

async function ensureMapper(request: ReturnType<typeof adminApi>, clientUuid: string): Promise<void> {
  const path = `/clients/${encodeURIComponent(clientUuid)}/protocol-mappers/models`;
  const listed = await request(path);
  if (listed.status !== 200 || !Array.isArray(listed.json)) fail('mapper list');
  const mapper = listed.json.find(
    (item): item is MapperRep => isRecord(item) && item.name === MAPPER,
  );
  const config = {
    'included.custom.audience': AUDIENCE,
    'access.token.claim': 'true',
    'id.token.claim': 'false',
  };
  if (!mapper) {
    const created = await request(path, {
      method: 'POST',
      body: JSON.stringify({
        name: MAPPER,
        protocol: 'openid-connect',
        protocolMapper: 'oidc-audience-mapper',
        consentRequired: false,
        config,
      }),
    });
    if (created.status !== 201 && created.status !== 204) fail('mapper create');
    return;
  }
  const mapperConfig = mapper.config ?? {};
  const same =
    mapper.protocolMapper === 'oidc-audience-mapper' &&
    mapperConfig['included.custom.audience'] === AUDIENCE &&
    mapperConfig['access.token.claim'] === 'true' &&
    mapperConfig['id.token.claim'] === 'false';
  if (same || !mapper.id) return;
  const saved = await request(`${path}/${encodeURIComponent(mapper.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ ...mapper, protocol: 'openid-connect', protocolMapper: 'oidc-audience-mapper', config }),
  });
  if (saved.status !== 204 && saved.status !== 200) fail('mapper update');
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const value = issuer();
  const { origin, realm } = realmOf(value);
  if (command === 'profile') {
    const request = adminApi(origin, realm, await adminToken(origin));
    await declareProfile(request);
    return;
  }
  if (command === 'users') {
    await importUsers();
    return;
  }
  if (command === 'client') {
    await alignClient();
    return;
  }
  fail('usage: profile | users | client');
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch(() => {
    console.error('oidc import failed');
    process.exit(1);
  });
}
