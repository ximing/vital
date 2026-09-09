import {
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
export const apiMarkdownPath = path.join(repoRoot, 'skills/vital/references/api.md');
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
  const re = /app\.(get|post|patch|put|delete)\(\s*'([^']+)'/g;
  let match = re.exec(source);
  while (match) {
    const method = (match[1] ?? 'get').toUpperCase();
    const routePath = match[2] ?? '';
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
  const callRe = /http\.request(?:WithStatus)?\(\s*(['"`])([^'"`]+)\1/g;
  let call = callRe.exec(impl);
  while (call) {
    const routePath = normalizePath(call[2] ?? '');
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

async function collectInterfaces(): Promise<string> {
  const entries = await fs.readdir(dtoDir);
  const blocks: string[] = [];
  for (const name of entries.sort()) {
    if (!name.endsWith('.ts') || name === 'index.ts') continue;
    const source = await fs.readFile(path.join(dtoDir, name), 'utf8');
    const re = /export interface \w+(?:\s+extends\s+[^{]+)? \{[\s\S]*?\n\}/g;
    let match = re.exec(source);
    while (match) {
      const body = match[0]?.trim();
      if (body !== undefined) blocks.push(body);
      match = re.exec(source);
    }
  }
  return blocks.map((block) => `\`\`\`ts\n${block}\n\`\`\``).join('\n\n');
}

function groupName(routePath: string): string {
  const parts = routePath.split('/').filter(Boolean);
  if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] !== undefined) return parts[2];
  if (parts[0] === 'api' && parts[1] === 'health') return 'health';
  return parts[1] ?? 'other';
}

const GROUP_ORDER = [
  'tokens',
  'auth',
  'lists',
  'tasks',
  'tags',
  'inbox',
  'reports',
  'search',
  'uploads',
  'notification-channels',
  'llm',
  'sync',
  'health',
];

export async function generateApiMarkdown(): Promise<string> {
  const [routes, clientSource, notes, types] = await Promise.all([
    collectRoutes(),
    fs.readFile(clientPath, 'utf8'),
    readNotes(),
    collectInterfaces(),
  ]);
  const clientOps = parseClientOps(clientSource);
  const sorted = [...routes].sort((a, b) => {
    const ga = GROUP_ORDER.indexOf(groupName(a.path));
    const gb = GROUP_ORDER.indexOf(groupName(b.path));
    const ia = ga === -1 ? GROUP_ORDER.length : ga;
    const ib = gb === -1 ? GROUP_ORDER.length : gb;
    if (ia !== ib) return ia - ib;
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    return a.method.localeCompare(b.method);
  });

  const lines: string[] = [
    '<!-- Generated by apps/server/scripts/gen-vital-skill.ts. Do not edit. -->',
    '<!-- Source: apps/server/src/**/*.routes.ts, packages/dto, packages/api-client. -->',
    '',
    '# Vital HTTP API',
    '',
    'Regenerate with `pnpm gen:vital-skill`.',
    '',
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
    '## Types',
    '',
    types,
    '',
    '## Endpoints',
    '',
  ];

  let currentGroup = '';
  for (const route of sorted) {
    const group = groupName(route.path);
    if (group !== currentGroup) {
      currentGroup = group;
      lines.push(`### ${group}`, '');
    }
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
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export async function writeApiMarkdown(): Promise<string> {
  const markdown = await generateApiMarkdown();
  await fs.mkdir(path.dirname(apiMarkdownPath), { recursive: true });
  await fs.writeFile(apiMarkdownPath, markdown);
  return markdown;
}

const invoked =
  process.argv[1] !== undefined && path.basename(process.argv[1]).includes('gen-vital-skill');
if (invoked) {
  void writeApiMarkdown().then((markdown) => {
    process.stdout.write(`wrote ${apiMarkdownPath} (${String(markdown.length)} bytes)\n`);
  });
}
