import {
  AGENT_SCHEDULE_CAPABILITIES,
  API_TOKEN_ACCESS_RETENTION_DAYS,
  API_TOKEN_MAX_PER_USER,
  API_TOKEN_PREFIX,
  ERROR_MESSAGES,
  SMART_LIST_IDS,
} from '@vital/dto';
import * as dto from '@vital/dto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ZodTypeAny } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../../..');
export const referencesDir = path.join(repoRoot, 'skills/vital/references');
/** @deprecated split catalog; tests use referencesDir */
export const apiMarkdownPath = path.join(referencesDir, 'index.md');
const notesPath = path.join(repoRoot, 'skills/vital/notes.json');
const routesDir = path.join(repoRoot, 'apps/server/src');
const clientPath = path.join(repoRoot, 'packages/api-client/src/client.ts');
const dtoDir = path.join(repoRoot, 'packages/dto/src');

export interface ParsedRoute {
  method: string;
  path: string;
  auth: boolean;
  websocket: boolean;
  bodySchema?: string;
  querySchema?: string;
  paramsSchema?: string;
  status?: number;
  description?: string;
}

type ClientOp = { methodName: string; returnType: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isZodType(value: unknown): value is ZodTypeAny {
  return isRecord(value) && '_def' in value;
}

function defOf(schema: ZodTypeAny): Record<string, unknown> {
  if (!('_def' in schema) || !isRecord(schema._def)) return {};
  return schema._def;
}

function typeNameOf(schema: ZodTypeAny): string {
  const typeName = defOf(schema)['typeName'];
  return typeof typeName === 'string' ? typeName : '';
}

function asZod(value: unknown): ZodTypeAny | undefined {
  return isZodType(value) ? value : undefined;
}

function unwrap(schema: ZodTypeAny): { schema: ZodTypeAny; optional: boolean; nullable: boolean } {
  let current = schema;
  let optional = false;
  let nullable = false;
  for (let i = 0; i < 16; i += 1) {
    const name = typeNameOf(current);
    const def = defOf(current);
    if (name === 'ZodOptional') optional = true;
    if (name === 'ZodNullable') nullable = true;
    if (
      name === 'ZodOptional' ||
      name === 'ZodNullable' ||
      name === 'ZodDefault' ||
      name === 'ZodCatch' ||
      name === 'ZodBranded' ||
      name === 'ZodReadonly'
    ) {
      const inner = asZod(def['innerType']);
      if (!inner) break;
      current = inner;
      continue;
    }
    if (name === 'ZodEffects') {
      const inner = asZod(def['schema']);
      if (!inner) break;
      current = inner;
      continue;
    }
    if (name === 'ZodPipeline') {
      const out = asZod(def['out']);
      if (!out) break;
      current = out;
      continue;
    }
    break;
  }
  return { schema: current, optional, nullable };
}

function stringChecks(schema: ZodTypeAny): string[] {
  const checks = defOf(schema)['checks'];
  if (!Array.isArray(checks)) return [];
  const parts: string[] = [];
  let min: number | undefined;
  let max: number | undefined;
  for (const check of checks) {
    if (!isRecord(check) || typeof check['kind'] !== 'string') continue;
    const kind = check['kind'];
    if (kind === 'uuid') return ['uuid'];
    if (kind === 'email') parts.push('email');
    if (kind === 'url') parts.push('url');
    if (kind === 'datetime') parts.push('iso datetime');
    if (kind === 'regex') parts.push('pattern');
    if (kind === 'min' && typeof check['value'] === 'number') min = check['value'];
    if (kind === 'max' && typeof check['value'] === 'number') max = check['value'];
  }
  if (min !== undefined || max !== undefined) {
    parts.unshift(`${String(min ?? 0)}–${max === undefined ? '…' : String(max)}`);
  }
  return parts;
}

function numberChecks(schema: ZodTypeAny): string[] {
  const checks = defOf(schema)['checks'];
  if (!Array.isArray(checks)) return [];
  const parts: string[] = [];
  for (const check of checks) {
    if (!isRecord(check) || typeof check['kind'] !== 'string') continue;
    if (check['kind'] === 'int') parts.push('int');
    if (check['kind'] === 'min' && typeof check['value'] === 'number') {
      parts.push(`min ${String(check['value'])}`);
    }
    if (check['kind'] === 'max' && typeof check['value'] === 'number') {
      parts.push(`max ${String(check['value'])}`);
    }
  }
  return parts;
}

export function printZod(schema: ZodTypeAny): string {
  const { schema: core, optional, nullable } = unwrap(schema);
  const name = typeNameOf(core);
  let inner = 'unknown';
  if (name === 'ZodString') {
    const checks = stringChecks(core);
    inner = checks.includes('uuid') ? 'uuid' : ['string', ...checks].join(' ');
  } else if (name === 'ZodNumber') {
    inner = ['number', ...numberChecks(core)].join(' ');
  } else if (name === 'ZodBoolean') {
    inner = 'boolean';
  } else if (name === 'ZodNull') {
    inner = 'null';
  } else if (name === 'ZodLiteral') {
    inner = JSON.stringify(defOf(core)['value']);
  } else if (name === 'ZodEnum') {
    const values = defOf(core)['values'];
    inner = Array.isArray(values) ? values.map((v) => JSON.stringify(v)).join(' | ') : 'enum';
  } else if (name === 'ZodArray') {
    const el = asZod(defOf(core)['type']);
    inner = `${el ? printZod(el) : 'unknown'}[]`;
  } else if (name === 'ZodRecord') {
    inner = 'object';
  } else if (name === 'ZodUnion') {
    const options = defOf(core)['options'];
    if (Array.isArray(options)) {
      inner = options.map((opt) => (isZodType(opt) ? printZod(opt) : 'unknown')).join(' | ');
    }
  } else if (name === 'ZodObject' && 'shape' in core && isRecord(core.shape)) {
    const fields = Object.entries(core.shape).map(([key, value]) => {
      if (!isZodType(value)) return `${key}: unknown`;
      return `${key}: ${printZod(value)}`;
    });
    inner = `{ ${fields.join('; ')} }`;
  } else if (name === 'ZodLazy') {
    inner = 'lazy';
  }
  if (optional) inner += ' (optional)';
  if (nullable) inner += ' | null';
  return inner;
}

export function printZodFields(schema: ZodTypeAny, indent = ''): string[] {
  const { schema: core } = unwrap(schema);
  if (typeNameOf(core) !== 'ZodObject' || !('shape' in core) || !isRecord(core.shape)) {
    return [`${indent}- ${printZod(schema)}`];
  }
  const lines: string[] = [];
  for (const [key, value] of Object.entries(core.shape)) {
    if (!isZodType(value)) {
      lines.push(`${indent}- \`${key}\`: unknown`);
      continue;
    }
    const wrapped = unwrap(value);
    const nested = typeNameOf(wrapped.schema) === 'ZodObject';
    const flags = [
      wrapped.optional ? 'optional' : undefined,
      wrapped.nullable ? 'nullable' : undefined,
    ].filter((item): item is string => item !== undefined);
    const suffix = flags.length > 0 ? ` (${flags.join(', ')})` : '';
    if (nested) {
      lines.push(`${indent}- \`${key}\`${suffix}:`);
      lines.push(...printZodFields(wrapped.schema, `${indent}  `));
    } else {
      lines.push(`${indent}- \`${key}\`: ${printZod(wrapped.schema)}${suffix}`);
    }
  }
  return lines;
}

function jsdocBefore(source: string, index: number): string | undefined {
  const before = source.slice(Math.max(0, index - 400), index);
  const match = /\/\*\*\s*([\s\S]*?)\s*\*\/\s*$/.exec(before);
  const body = match?.[1];
  if (body === undefined) return undefined;
  const text = body.replace(/^\s*\*\s?/gm, '').trim();
  return text === '' ? undefined : text;
}

function handlerSnippet(source: string, start: number): string {
  const rest = source.slice(start);
  const next = rest.slice(1).search(/app\.(get|post|patch|put|delete)\(/);
  if (next === -1) return rest.slice(0, 2500);
  return rest.slice(0, next + 1);
}

export function parseRouteSource(source: string): ParsedRoute[] {
  const routes: ParsedRoute[] = [];
  const re = /app\.(get|post|patch|put|delete)\(\s*(?:'([^']+)'|`([^`]+)`)/g;
  let match = re.exec(source);
  while (match) {
    const method = (match[1] ?? 'get').toUpperCase();
    const routePath = normalizePath(match[2] ?? match[3] ?? '');
    const snippet = handlerSnippet(source, match.index);
    const websocket = /websocket:\s*true/.test(snippet);
    const auth =
      /preHandler:\s*\[[^\]]*\brequireAuth\b/.test(snippet) ||
      /preHandler:\s*\[\s*requireAuth\s*\]/.test(snippet);
    const body = /\b(\w+)\.parse\(\s*req\.body/.exec(snippet)?.[1];
    const query = /\b(\w+)\.parse\(\s*req\.query/.exec(snippet)?.[1];
    const params = /\b(\w+)\.parse\(\s*req\.params/.exec(snippet)?.[1];
    const code = /reply\.code\((\d+)\)/.exec(snippet)?.[1];
    const parsed: ParsedRoute = {
      method,
      path: routePath,
      auth,
      websocket,
    };
    if (body !== undefined) parsed.bodySchema = body;
    if (query !== undefined) parsed.querySchema = query;
    if (params !== undefined) parsed.paramsSchema = params;
    if (code !== undefined) parsed.status = Number(code);
    const description = jsdocBefore(source, match.index);
    if (description !== undefined) parsed.description = description;
    routes.push(parsed);
    match = re.exec(source);
  }
  return routes;
}

function normalizePath(raw: string): string {
  return raw.replace(/\$\{(\w+)\}/g, ':$1');
}

function readJsStringHead(source: string, start: number): string | undefined {
  const quote = source[start];
  if (quote !== "'" && quote !== '"' && quote !== '`') return undefined;
  if (quote === "'" || quote === '"') {
    let i = start + 1;
    let raw = '';
    while (i < source.length) {
      const ch = source.charAt(i);
      if (ch === '\\') {
        raw += source.charAt(i + 1);
        i += 2;
        continue;
      }
      if (ch === quote) return raw;
      raw += ch;
      i += 1;
    }
    return undefined;
  }
  let i = start + 1;
  let raw = '';
  while (i < source.length) {
    const ch = source.charAt(i);
    if (ch === '\\') {
      raw += source.charAt(i + 1);
      i += 2;
      continue;
    }
    if (ch === '`') return raw;
    if (ch === '$' && source.charAt(i + 1) === '{') {
      const close = source.indexOf('}', i + 2);
      if (close < 0) return raw;
      const expr = source.slice(i + 2, close);
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(expr)) {
        raw += `\${${expr}}`;
        i = close + 1;
        continue;
      }
      return raw;
    }
    raw += ch;
    i += 1;
  }
  return raw;
}

export function normalizeClientPath(raw: string): string {
  return normalizePath(raw.replace(/\?.*$/, ''));
}

function parseClientOps(source: string): Map<string, ClientOp> {
  const returns = new Map<string, string>();
  const iface = /export interface VitalClient \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? '';
  const sigRe = /(\w+)\(([\s\S]*?)\):\s*Promise<([\s\S]*?)>;/g;
  let sig = sigRe.exec(iface);
  while (sig) {
    const name = sig[1];
    const ret = sig[3]?.replace(/\s+/g, ' ').trim();
    if (name !== undefined && ret !== undefined) returns.set(name, ret);
    sig = sigRe.exec(iface);
  }

  const implStart = source.indexOf('export function createVitalClient');
  const impl = implStart >= 0 ? source.slice(implStart) : source;
  const ops = new Map<string, ClientOp>();
  const callRe = /http\.request(?:WithStatus)?\(/g;
  let call = callRe.exec(impl);
  while (call) {
    const after = impl.slice(call.index + call[0].length);
    const ws = /^\s*/.exec(after)?.[0].length ?? 0;
    const raw = readJsStringHead(after, ws);
    if (raw === undefined || raw === '') {
      call = callRe.exec(impl);
      continue;
    }
    const routePath = normalizeClientPath(raw);
    const fromCall = impl.slice(call.index);
    const nextCall = fromCall.slice(1).search(/http\.request(?:WithStatus)?\(/);
    const thisCall = nextCall === -1 ? fromCall.slice(0, 500) : fromCall.slice(0, nextCall + 1);
    const httpMethod = /method:\s*'([A-Z]+)'/.exec(thisCall)?.[1] ?? 'GET';
    const before = impl.slice(0, call.index);
    const keyMatches = [...before.matchAll(/^ {4}(\w+):\s*(?:async\s*)?\(/gm)];
    const fnMatches = [...before.matchAll(/async function (\w+)/g)];
    const key = keyMatches.at(-1);
    const fn = fnMatches.at(-1);
    let methodName: string | undefined;
    if (key && fn) {
      methodName = (key.index ?? 0) > (fn.index ?? 0) ? key[1] : fn[1];
    } else {
      methodName = key?.[1] ?? fn?.[1];
    }
    if (methodName !== undefined) {
      const returnType = returns.get(methodName) ?? 'unknown';
      ops.set(`${httpMethod} ${routePath}`, { methodName, returnType });
    }
    call = callRe.exec(impl);
  }
  return ops;
}

function dtoSchema(name: string): ZodTypeAny | undefined {
  const value: unknown = (dto as unknown as Record<string, unknown>)[name];
  return isZodType(value) ? value : undefined;
}

function paramFields(routePath: string, schemaName?: string): string[] {
  const schema = schemaName === undefined ? undefined : dtoSchema(schemaName);
  if (schema) return printZodFields(schema);
  const names = [...routePath.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1] ?? '');
  return names.map((name) => {
    if (name === 'partNumber') return `- \`${name}\`: integer > 0`;
    if (name === 'capability') {
      return `- \`${name}\`: ${AGENT_SCHEDULE_CAPABILITIES.map((id) => JSON.stringify(id)).join(' | ')}`;
    }
    return `- \`${name}\`: uuid`;
  });
}

function humanize(name: string): string {
  const spaced = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  if (spaced === '') return name;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

async function readNotes(): Promise<Record<string, string>> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(notesPath, 'utf8'));
    if (!isRecord(raw)) return {};
    const notes: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string' && value.trim() !== '') notes[key] = value.trim();
    }
    return notes;
  } catch {
    return {};
  }
}

async function collectRoutes(): Promise<ParsedRoute[]> {
  const entries = await fs.readdir(routesDir, { recursive: true });
  const files = entries
    .filter((name) => name.endsWith('.routes.ts'))
    .map((name) => path.join(routesDir, name));
  const routes: ParsedRoute[] = [];
  for (const file of files) {
    routes.push(...parseRouteSource(await fs.readFile(file, 'utf8')));
  }
  return routes.filter((route) => !route.websocket);
}

function isCatalogTypeAlias(body: string): boolean {
  if (/\bz\.infer\b/.test(body)) return false;
  return /\bOmit<|\bPick<|\bRecord</.test(body) || / = (?:\s*\|\s*)?[A-Z]\w+(?:\s*\|\s*[A-Z]\w+)+;/.test(body.replace(/\s+/g, ' '));
}

const DTO_FILE_GROUP: Record<string, string> = {
  'agent.ts': 'agent',
  'app-release.ts': 'app',
  'auth.ts': 'auth',
  'days.ts': 'days',
  'errors.ts': 'common',
  'habits.ts': 'habits',
  'inbox.ts': 'inbox',
  'inwit.ts': 'integrations',
  'lists.ts': 'lists',
  'llm-pricing.ts': 'llm',
  'llm.ts': 'llm',
  'notifications.ts': 'notification-channels',
  'outcomes.ts': 'outcomes',
  'reportNotes.ts': 'reports',
  'reports.ts': 'reports',
  'reportTemplates.ts': 'reports',
  'search.ts': 'search',
  'sync.ts': 'sync',
  'tags.ts': 'tags',
  'tasks.ts': 'tasks',
  'tokens.ts': 'tokens',
  'uploads.ts': 'uploads',
};

function catalogTypeName(block: string): string {
  return /^export (?:interface|type) (\w+)/.exec(block)?.[1] ?? '';
}

function typeModule(dtoFile: string, typeName: string): string {
  if (dtoFile === 'outcomes.ts' && /^(Today|NowRecommendation)/.test(typeName)) return 'today';
  return DTO_FILE_GROUP[dtoFile] ?? 'common';
}

async function collectTypesByModule(): Promise<Map<string, string[]>> {
  const entries = await fs.readdir(dtoDir);
  const byModule = new Map<string, string[]>();
  for (const name of entries.sort()) {
    if (!name.endsWith('.ts') || name === 'index.ts') continue;
    const source = await fs.readFile(path.join(dtoDir, name), 'utf8');
    const re =
      /export (?:interface \w+(?:\s+extends\s+[^{]+)? \{[\s\S]*?\n\}|type \w+ = [\s\S]*?;)/g;
    let match = re.exec(source);
    while (match) {
      const body = match[0]?.trim();
      if (body !== undefined && (body.startsWith('export interface') || isCatalogTypeAlias(body))) {
        const module = typeModule(name, catalogTypeName(body));
        const list = byModule.get(module) ?? [];
        list.push(`\`\`\`ts\n${body}\n\`\`\``);
        byModule.set(module, list);
      }
      match = re.exec(source);
    }
  }
  return byModule;
}

function groupName(routePath: string): string {
  const parts = routePath.split('/').filter(Boolean);
  if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] !== undefined) return parts[2];
  if (parts[0] === 'api' && parts[1] === 'health') return 'health';
  return parts[1] ?? 'other';
}

/** Route prefix group → catalog module. Health is folded into common. */
function catalogModule(routePath: string): string {
  const group = groupName(routePath);
  return group === 'health' ? 'common' : group;
}

const MODULE_ORDER = [
  'common',
  'tokens',
  'auth',
  'today',
  'lists',
  'tasks',
  'tags',
  'inbox',
  'outcomes',
  'habits',
  'days',
  'reports',
  'search',
  'uploads',
  'notification-channels',
  'llm',
  'agent',
  'integrations',
  'sync',
  'app',
];

const MODULE_TITLE: Record<string, string> = {
  common: 'Common',
  tokens: 'Tokens',
  auth: 'Auth',
  today: 'Today',
  lists: 'Lists',
  tasks: 'Tasks',
  tags: 'Tags',
  inbox: 'Inbox',
  outcomes: 'Threads',
  habits: 'Habits',
  days: 'Days',
  reports: 'Reports',
  search: 'Search',
  uploads: 'Uploads',
  'notification-channels': 'Notification channels',
  llm: 'LLM',
  agent: 'Agent',
  integrations: 'Integrations',
  sync: 'Sync',
  app: 'App releases',
};

const GENERATED_BANNER = [
  '<!-- Generated by apps/server/scripts/gen-vital-skill.ts. Do not edit. -->',
  '<!-- Source: apps/server/src/**/*.routes.ts, packages/dto, packages/api-client. -->',
];

function renderRoute(
  route: ParsedRoute,
  clientOps: Map<string, ClientOp>,
  notes: Record<string, string>,
): string[] {
  const lines: string[] = [];
  const key = `${route.method} ${route.path}`;
  const op = clientOps.get(key);
  const note = notes[key];
  const summary = note ?? route.description ?? (op ? humanize(op.methodName) : undefined);
  lines.push(`#### \`${route.method} ${route.path}\``, '');
  if (summary !== undefined) {
    lines.push(summary, '');
  }
  lines.push(`- Auth: ${route.auth ? 'Bearer required' : 'none'}`);
  if (op) lines.push(`- Client: \`${op.methodName}\``);
  if (route.status !== undefined) lines.push(`- Status: ${String(route.status)}`);
  if (op) lines.push(`- Response: \`${op.returnType}\``);
  lines.push('');
  const params = paramFields(route.path, route.paramsSchema);
  if (params.length > 0 && route.path.includes(':')) {
    lines.push('Path params:', '');
    lines.push(...params, '');
  }
  if (route.querySchema !== undefined) {
    const schema = dtoSchema(route.querySchema);
    lines.push(`Query (\`${route.querySchema}\`):`, '');
    lines.push(...(schema ? printZodFields(schema) : [`- see \`${route.querySchema}\``]), '');
  }
  if (route.bodySchema !== undefined) {
    const schema = dtoSchema(route.bodySchema);
    lines.push(`Request body (\`${route.bodySchema}\`):`, '');
    lines.push(...(schema ? printZodFields(schema) : [`- see \`${route.bodySchema}\``]), '');
  }
  return lines;
}

function moduleHeader(title: string): string[] {
  return [
    ...GENERATED_BANNER,
    '',
    `# ${title}`,
    '',
    'Regenerate with `pnpm gen:vital-skill`. Load this file only when calling these endpoints.',
    '',
  ];
}

export async function generateApiCatalog(): Promise<Record<string, string>> {
  const [routes, clientSource, notes, typesByModule] = await Promise.all([
    collectRoutes(),
    fs.readFile(clientPath, 'utf8'),
    readNotes(),
    collectTypesByModule(),
  ]);
  const clientOps = parseClientOps(clientSource);
  const routesByModule = new Map<string, ParsedRoute[]>();
  for (const route of routes) {
    const module = catalogModule(route.path);
    const list = routesByModule.get(module) ?? [];
    list.push(route);
    routesByModule.set(module, list);
  }
  for (const list of routesByModule.values()) {
    list.sort((a, b) => {
      if (a.path !== b.path) return a.path.localeCompare(b.path);
      return a.method.localeCompare(b.method);
    });
  }

  const files: Record<string, string> = {};
  const indexRows: string[] = [];

  const commonLines = [
    ...moduleHeader('Common'),
    'Base URL: `VITAL_API_URL` or `https://vital.aimo.plus` (local `http://127.0.0.1:3010`).',
    '',
    'Authenticated `/api/v1` routes accept `Authorization: Bearer <token>`. Personal access tokens use the `vt_` prefix, skip refresh, and last until revoked.',
    '',
    '## Constants',
    '',
    `- token prefix: \`${API_TOKEN_PREFIX}\``,
    `- max tokens per user: ${String(API_TOKEN_MAX_PER_USER)}`,
    `- token access log retention: ${String(API_TOKEN_ACCESS_RETENTION_DAYS)} days`,
    `- smart list ids: ${SMART_LIST_IDS.map((id) => `\`${id}\``).join(', ')}`,
    '',
    '## Errors',
    '',
    'Every error response is `{ "error": { "code": string, "message": string, "details"?: unknown } }`.',
    '',
    '| code | message |',
    '| --- | --- |',
    ...Object.entries(ERROR_MESSAGES).map(([code, message]) => `| \`${code}\` | ${message} |`),
    '',
  ];
  const commonTypes = typesByModule.get('common') ?? [];
  if (commonTypes.length > 0) {
    commonLines.push('## Types', '', commonTypes.join('\n\n'), '');
  }
  const commonRoutes = routesByModule.get('common') ?? [];
  if (commonRoutes.length > 0) {
    commonLines.push('## Endpoints', '');
    for (const route of commonRoutes) commonLines.push(...renderRoute(route, clientOps, notes));
  }
  files['common.md'] = `${commonLines.join('\n').trimEnd()}\n`;
  indexRows.push('| Common | [common.md](common.md) |');

  for (const module of MODULE_ORDER) {
    if (module === 'common') continue;
    const moduleRoutes = routesByModule.get(module) ?? [];
    const moduleTypes = typesByModule.get(module) ?? [];
    if (moduleRoutes.length === 0 && moduleTypes.length === 0) continue;
    const title = MODULE_TITLE[module] ?? module;
    const lines = [...moduleHeader(title)];
    if (moduleTypes.length > 0) {
      lines.push('## Types', '', moduleTypes.join('\n\n'), '');
    }
    if (moduleRoutes.length > 0) {
      lines.push('## Endpoints', '');
      for (const route of moduleRoutes) lines.push(...renderRoute(route, clientOps, notes));
    }
    const filename = `${module}.md`;
    files[filename] = `${lines.join('\n').trimEnd()}\n`;
    indexRows.push(`| ${title} | [${filename}](${filename}) |`);
  }

  files['index.md'] = [
    ...GENERATED_BANNER,
    '',
    '# Vital API modules',
    '',
    'Regenerate with `pnpm gen:vital-skill`.',
    '',
    'Open **only** the module for the domain you are calling. Do not load every file.',
    '',
    '| Domain | File |',
    '| --- | --- |',
    ...indexRows,
    '',
  ].join('\n');

  return files;
}

export async function writeApiMarkdown(): Promise<Record<string, string>> {
  const files = await generateApiCatalog();
  await fs.mkdir(referencesDir, { recursive: true });
  const written = new Set(Object.keys(files));
  for (const [name, body] of Object.entries(files)) {
    await fs.writeFile(path.join(referencesDir, name), body);
  }
  const existing = await fs.readdir(referencesDir);
  for (const name of existing) {
    if (!name.endsWith('.md') || written.has(name)) continue;
    const full = path.join(referencesDir, name);
    const text = await fs.readFile(full, 'utf8');
    if (text.startsWith('<!-- Generated by apps/server/scripts/gen-vital-skill.ts')) {
      await fs.unlink(full);
    }
  }
  return files;
}

const invoked =
  process.argv[1] !== undefined && path.basename(process.argv[1]).includes('gen-vital-skill');
if (invoked) {
  void writeApiMarkdown().then((files) => {
    process.stdout.write(
      `wrote ${String(Object.keys(files).length)} files in ${referencesDir}\n`,
    );
  });
}
