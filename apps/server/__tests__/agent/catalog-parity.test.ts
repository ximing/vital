/**
 * Closed-vocabulary drift alarm. Source is read as text so this stays DB-free
 * (importing apps/server modules opens Postgres).
 * habit.spawn is the one job type in the CHECK and copy maps with no processor case.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLM_CAPABILITIES, agentActionTypeSchema } from '@vital/dto';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/** In agent_jobs_type_check and the copy maps, but not a processAgentJobInner case. */
const FOSSIL_JOB_TYPE = 'habit.spawn';

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

/** Screen copy is split per top-level key. Parity still sees one vocabulary. */
function readCopyDir(rel: string): string {
  return readdirSync(join(repoRoot, rel))
    .filter((name) => name.endsWith('.ts'))
    .sort()
    .map((name) => readFileSync(join(repoRoot, rel, name), 'utf8'))
    .join('\n');
}

function snippet(source: string, index: number): string {
  const line = source.slice(0, index).split('\n').length;
  return `line ${line}: ${source.slice(index, index + 48).replaceAll('\n', '\\n')}`;
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function isIdentStart(char: string): boolean {
  return /[A-Za-z_$]/.test(char);
}

function isIdentPart(char: string): boolean {
  return /[\w$]/.test(char);
}

function skipTrivia(source: string, index: number): number {
  let i = index;
  while (i < source.length) {
    const char = source.charAt(i);
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      i += 1;
      continue;
    }
    if (char === '/' && source.charAt(i + 1) === '/') {
      const nl = source.indexOf('\n', i);
      i = nl < 0 ? source.length : nl + 1;
      continue;
    }
    if (char === '/' && source.charAt(i + 1) === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) throw new Error(`unterminated block comment ${snippet(source, i)}`);
      i = end + 2;
      continue;
    }
    break;
  }
  return i;
}

function skipBalanced(source: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  let i = openIndex;
  while (i < source.length) {
    const char = source.charAt(i);
    if (char === '/' && source.charAt(i + 1) === '/') {
      const nl = source.indexOf('\n', i);
      i = nl < 0 ? source.length : nl + 1;
      continue;
    }
    if (char === '/' && source.charAt(i + 1) === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) throw new Error(`unterminated block comment ${snippet(source, i)}`);
      i = end + 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      i = skipString(source, i).next;
      continue;
    }
    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  throw new Error(`unbalanced '${open}' ${snippet(source, openIndex)}`);
}

function skipString(source: string, index: number): { next: number; value: string } {
  const quote = source.charAt(index);
  if (quote !== "'" && quote !== '"' && quote !== '`') {
    throw new Error(`expected string ${snippet(source, index)}`);
  }
  let value = '';
  let i = index + 1;
  while (i < source.length) {
    const char = source.charAt(i);
    if (char === '\\') {
      value += source.charAt(i + 1);
      i += 2;
      continue;
    }
    if (quote === '`' && char === '$' && source.charAt(i + 1) === '{') {
      i = skipBalanced(source, i + 1, '{', '}');
      continue;
    }
    if (char === quote) return { next: i + 1, value };
    value += char;
    i += 1;
  }
  throw new Error(`unterminated string ${snippet(source, index)}`);
}

function readIdent(source: string, index: number): { value: string; next: number } {
  if (!isIdentStart(source.charAt(index)))
    throw new Error(`expected ident ${snippet(source, index)}`);
  let i = index + 1;
  while (isIdentPart(source.charAt(i))) i += 1;
  return { value: source.slice(index, i), next: i };
}

function skipMemberOrIdent(source: string, index: number): number {
  let next = readIdent(source, index).next;
  while (true) {
    const dot = skipTrivia(source, next);
    if (source.charAt(dot) !== '.') return next;
    const after = skipTrivia(source, dot + 1);
    if (!isIdentStart(source.charAt(after))) return next;
    next = readIdent(source, after).next;
  }
}

function skipSpread(source: string, index: number): number {
  if (!source.startsWith('...', index))
    throw new Error(`expected spread ${snippet(source, index)}`);
  return skipMemberOrIdent(source, skipTrivia(source, index + 3));
}

function skipNumber(source: string, index: number): number {
  let i = index;
  if (source.charAt(i) === '-') i += 1;
  if (!isDigit(source.charAt(i))) throw new Error(`expected number ${snippet(source, index)}`);
  while (isDigit(source.charAt(i))) i += 1;
  if (source.charAt(i) === '.' && isDigit(source.charAt(i + 1))) {
    i += 1;
    while (isDigit(source.charAt(i))) i += 1;
  }
  return i;
}

function skipTypeAssertion(source: string, index: number): number {
  const i = skipTrivia(source, index + 2);
  const char = source.charAt(i);
  if (char === '{') return skipBalanced(source, i, '{', '}');
  if (char === '(') return skipBalanced(source, i, '(', ')');
  if (isIdentStart(char)) return skipMemberOrIdent(source, i);
  throw new Error(`expected type assertion ${snippet(source, index)}`);
}

interface ObjectFrame {
  kind: 'object';
  keys: string[];
  phase: 'key' | 'colon' | 'value' | 'comma';
}

interface ArrayFrame {
  kind: 'array';
  phase: 'value' | 'comma';
}

type Frame = ObjectFrame | ArrayFrame;

/** Direct keys of every object literal. Copy files are data, not executable modules. */
function objectKeyLists(source: string): string[][] {
  const objects: string[][] = [];
  const frames: Frame[] = [];
  let i = 0;
  let prev = '';

  const pop = (): void => {
    const frame = frames.pop();
    if (!frame) throw new Error('unbalanced object');
    if (frame.kind === 'object') objects.push(frame.keys);
    const parent = frames[frames.length - 1];
    if (parent && parent.phase === 'value') parent.phase = 'comma';
  };

  while (i < source.length) {
    i = skipTrivia(source, i);
    if (i >= source.length) break;
    const char = source.charAt(i);
    const top = frames[frames.length - 1];

    if (!top) {
      if (char === "'" || char === '"' || char === '`') {
        i = skipString(source, i).next;
        prev = 'str';
        continue;
      }
      if (char === '{') {
        if (prev === '=') frames.push({ kind: 'object', keys: [], phase: 'key' });
        else i = skipBalanced(source, i, '{', '}') - 1;
        prev = char;
        i += 1;
        continue;
      }
      if (char === '(') {
        i = skipBalanced(source, i, '(', ')');
        prev = ')';
        continue;
      }
      prev = char;
      i += 1;
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      const str = skipString(source, i);
      if (top.kind === 'object' && top.phase === 'key') {
        top.keys.push(str.value);
        top.phase = 'colon';
      } else if (top.phase === 'value') {
        top.phase = 'comma';
      } else {
        throw new Error(`unexpected string ${snippet(source, i)}`);
      }
      i = str.next;
      continue;
    }

    if (top.kind === 'object' && top.phase === 'key') {
      if (char === '}') {
        i += 1;
        pop();
        continue;
      }
      if (source.startsWith('...', i)) {
        i = skipSpread(source, i);
        top.phase = 'comma';
        continue;
      }
      if (isIdentStart(char)) {
        const ident = readIdent(source, i);
        top.keys.push(ident.value);
        top.phase = 'colon';
        i = ident.next;
        continue;
      }
      if (isDigit(char)) {
        const start = i;
        i = skipNumber(source, i);
        top.keys.push(source.slice(start, i));
        top.phase = 'colon';
        continue;
      }
      throw new Error(`expected object key ${snippet(source, i)}`);
    }

    if (top.kind === 'object' && top.phase === 'colon') {
      // Split copy facades use shorthand properties: `{ brand, nav }`.
      if (char === ',' || char === '}') {
        top.phase = 'comma';
        continue;
      }
      if (char !== ':') throw new Error(`expected ':' ${snippet(source, i)}`);
      top.phase = 'value';
      i += 1;
      continue;
    }

    if (top.phase === 'value') {
      if (char === '{') {
        frames.push({ kind: 'object', keys: [], phase: 'key' });
        i += 1;
        continue;
      }
      if (char === '[') {
        frames.push({ kind: 'array', phase: 'value' });
        i += 1;
        continue;
      }
      if (char === ']' && top.kind === 'array') {
        i += 1;
        pop();
        continue;
      }
      if (source.startsWith('...', i)) {
        i = skipSpread(source, i);
        top.phase = 'comma';
        continue;
      }
      if (isIdentStart(char)) {
        i = skipMemberOrIdent(source, i);
        top.phase = 'comma';
        continue;
      }
      if (char === '-' || isDigit(char)) {
        i = skipNumber(source, i);
        top.phase = 'comma';
        continue;
      }
      throw new Error(`expected value ${snippet(source, i)}`);
    }

    if (char === ',') {
      top.phase = top.kind === 'object' ? 'key' : 'value';
      i += 1;
      continue;
    }
    if ((char === '}' && top.kind === 'object') || (char === ']' && top.kind === 'array')) {
      i += 1;
      pop();
      continue;
    }
    if (source.startsWith('as', i) && !isIdentPart(source.charAt(i + 2))) {
      i = skipTypeAssertion(source, i);
      continue;
    }
    throw new Error(`expected ',' or closer ${snippet(source, i)}`);
  }

  if (frames.length !== 0) throw new Error('unclosed object while reading copy map');
  return objects;
}

function objectKeysContaining(source: string, key: string): string[] {
  const matches = objectKeyLists(source).filter((keys) => keys.includes(key));
  if (matches.length !== 1) {
    throw new Error(`expected one object containing '${key}', found ${matches.length}`);
  }
  const keys = matches[0];
  if (!keys || keys.length === 0) throw new Error(`empty object containing '${key}'`);
  return keys;
}

function checkInList(source: string, checkName: string): string[] {
  const at = source.indexOf(`'${checkName}'`);
  if (at < 0) throw new Error(`missing check ${checkName}`);
  const nextCheck = source.indexOf('check(', at + checkName.length);
  const region = source.slice(at, nextCheck < 0 ? at + 8000 : nextCheck);
  const inRel = region.search(/IN\s*\(/);
  if (inRel < 0) throw new Error(`missing IN list for ${checkName}`);
  let i = at + inRel;
  const open = source.indexOf('(', i);
  i = open + 1;
  const values: string[] = [];
  while (i < source.length) {
    i = skipTrivia(source, i);
    const char = source.charAt(i);
    if (char === ')') break;
    if (char === ',') {
      i += 1;
      continue;
    }
    if (char !== "'" && char !== '"') {
      throw new Error(`expected quoted IN value for ${checkName} ${snippet(source, i)}`);
    }
    const str = skipString(source, i);
    values.push(str.value);
    i = str.next;
  }
  if (values.length === 0) throw new Error(`empty IN list for ${checkName}`);
  return values;
}

function functionBodyBrace(source: string, name: string): number {
  const head = source.search(new RegExp(`\\bfunction\\s+${name}\\s*\\(`));
  if (head < 0) throw new Error(`missing function ${name}`);
  const paren = source.indexOf('(', head);
  let i = skipBalanced(source, paren, '(', ')');
  let angles = 0;
  while (i < source.length) {
    const char = source.charAt(i);
    if (char === '/' && source.charAt(i + 1) === '/') {
      const nl = source.indexOf('\n', i);
      i = nl < 0 ? source.length : nl + 1;
      continue;
    }
    if (char === '/' && source.charAt(i + 1) === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) throw new Error(`unterminated block comment ${snippet(source, i)}`);
      i = end + 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      i = skipString(source, i).next;
      continue;
    }
    if (char === '<') angles += 1;
    else if (char === '>') angles = Math.max(0, angles - 1);
    else if (char === '{' && angles === 0) return i;
    i += 1;
  }
  throw new Error(`missing body for ${name}`);
}

function jobTypeCases(source: string): string[] {
  const brace = functionBodyBrace(source, 'processAgentJobInner');
  const body = source.slice(brace, skipBalanced(source, brace, '{', '}'));
  const labels: string[] = [];
  const switchRe = /switch\s*\(\s*job\.jobType\s*\)/g;
  for (const match of body.matchAll(switchRe)) {
    const from = match.index + match[0].length;
    const open = body.indexOf('{', from);
    const block = body.slice(open, skipBalanced(body, open, '{', '}'));
    for (const label of block.matchAll(/^\s*case\s+(['"])([^'"]+)\1\s*:/gm)) {
      const value = label[2];
      if (value !== undefined) labels.push(value);
    }
  }
  if (labels.length === 0) throw new Error('no case labels in processAgentJobInner');
  return labels;
}

function exportedArrayTokens(source: string, name: string): string[] {
  const re = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[`);
  const match = re.exec(source);
  if (!match) throw new Error(`missing ${name}`);
  let i = match.index + match[0].length;
  const tokens: string[] = [];
  while (i < source.length) {
    i = skipTrivia(source, i);
    const char = source.charAt(i);
    if (char === ']') break;
    if (char === ',') {
      i += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      const str = skipString(source, i);
      tokens.push(str.value);
      i = str.next;
      continue;
    }
    if (isIdentStart(char)) {
      const ident = readIdent(source, i);
      tokens.push(ident.value);
      i = ident.next;
      continue;
    }
    throw new Error(`bad token in ${name} ${snippet(source, i)}`);
  }
  return tokens;
}

function exportedStringConst(source: string, name: string): string | undefined {
  const match = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*(['"])([^'"]*)\\1`).exec(source);
  return match?.[2];
}

function resolveJobToken(token: string, errandSource: string): string {
  if (!/^[A-Za-z_$][\w$]*$/.test(token)) return token;
  const direct = exportedStringConst(errandSource, token);
  if (direct !== undefined) return direct;
  const reexport = new RegExp(
    `export\\s*\\{[^}]*\\b${token}\\b[^}]*\\}\\s*from\\s*['"](\\./[^'"]+)['"]`,
  ).exec(errandSource);
  const spec = reexport?.[1];
  if (spec !== undefined) {
    const rel = spec.replace(/^\.\//, '').replace(/\.js$/, '.ts');
    const nested = exportedStringConst(readRepo(`apps/server/src/agent/${rel}`), token);
    if (nested !== undefined) return nested;
  }
  throw new Error(`cannot resolve ${token} from errand.ts`);
}

function isEventTypeEquality(source: string, stringAt: number): boolean {
  let j = stringAt - 1;
  while (j >= 0 && /\s/.test(source.charAt(j))) j -= 1;
  if (source.charAt(j) !== '=' || source.charAt(j - 1) !== '=' || source.charAt(j - 2) !== '=')
    return false;
  if (source.charAt(j - 3) === '!') return false;
  j -= 3;
  while (j >= 0 && /\s/.test(source.charAt(j))) j -= 1;
  const name = 'eventType';
  const start = j - name.length + 1;
  if (source.slice(start, j + 1) !== name) return false;
  const boundary = source.charAt(start - 1);
  return boundary === '' || !/[\w$]/.test(boundary);
}

function dispatchEventLiterals(source: string): { literals: Set<string>; compared: string[] } {
  const literals = new Set<string>();
  const compared: string[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source.charAt(i);
    if (char === '/' && source.charAt(i + 1) === '/') {
      const nl = source.indexOf('\n', i);
      i = nl < 0 ? source.length : nl + 1;
      continue;
    }
    if (char === '/' && source.charAt(i + 1) === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) throw new Error(`unterminated block comment ${snippet(source, i)}`);
      i = end + 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      const start = i;
      const str = skipString(source, i);
      const raw = source.slice(start, str.next);
      const interpolated = char === '`' && raw.includes('${');
      if (!interpolated) literals.add(str.value);
      if (char !== '`' && isEventTypeEquality(source, start)) compared.push(str.value);
      i = str.next;
      continue;
    }
    i += 1;
  }
  return { literals, compared };
}

function expectSameMembers(
  label: string,
  actual: readonly string[],
  expected: readonly string[],
): void {
  const sorted = [...actual].sort();
  const duplicates = [...new Set(sorted.filter((value, index) => value === sorted[index - 1]))];
  const actualValues = [...new Set(sorted)];
  const expectedValues = [...new Set(expected)].sort();
  const missing = expectedValues.filter((value) => !actualValues.includes(value));
  const extra = actualValues.filter((value) => !expectedValues.includes(value));
  expect({ label, missing, extra, duplicates }).toEqual({
    label,
    missing: [],
    extra: [],
    duplicates: [],
  });
}

describe('closed vocabulary parity', () => {
  const userLlm = readRepo('apps/server/src/db/schema/user-llm.ts');
  const agentSchema = readRepo('apps/server/src/db/schema/agent.ts');
  const notificationsSchema = readRepo('apps/server/src/db/schema/notifications.ts');
  const processors = readRepo('apps/server/src/agent/processors.ts');
  const scheduler = readRepo('apps/server/src/agent/scheduler.ts');
  const errand = readRepo('apps/server/src/agent/errand.ts');
  const dispatch = readRepo('apps/server/src/notifications/dispatch.ts');
  const webCopy = readCopyDir('apps/web/src/copy');
  const mobileCopy = readCopyDir('apps/mobile/src/lib/copy');

  const jobTypes = checkInList(agentSchema, 'agent_jobs_type_check');

  it('user_llm_routes capability CHECK matches LLM_CAPABILITIES', () => {
    expectSameMembers(
      'user_llm_routes_capability_check',
      checkInList(userLlm, 'user_llm_routes_capability_check'),
      LLM_CAPABILITIES,
    );
  });

  it('agent_jobs CHECK matches processAgentJobInner cases plus habit.spawn', () => {
    const cases = jobTypeCases(processors);
    expect(cases).not.toContain(FOSSIL_JOB_TYPE);
    expectSameMembers('agent_jobs_type_check', jobTypes, [...cases, FOSSIL_JOB_TYPE]);
  });

  it('DEMAND_ONLY_JOB_TYPES is a subset of the agent_jobs CHECK', () => {
    const demand = exportedArrayTokens(scheduler, 'DEMAND_ONLY_JOB_TYPES').map((token) =>
      resolveJobToken(token, errand),
    );
    const allowed = new Set(jobTypes);
    const outside = [...new Set(demand)].filter((jobType) => !allowed.has(jobType)).sort();
    expect({ outside }).toEqual({ outside: [] });
  });

  it('agent_actions CHECK matches agentActionTypeSchema', () => {
    expectSameMembers(
      'agent_actions_type_check',
      checkInList(agentSchema, 'agent_actions_type_check'),
      agentActionTypeSchema.options,
    );
  });

  it('dispatch eventType comparisons are the notification CHECK except task.due', () => {
    const events = checkInList(notificationsSchema, 'notification_outbox_event_type_check');
    const { compared } = dispatchEventLiterals(dispatch);
    const allowed = new Set(events);
    const comparedSet = new Set(compared);
    // task.due is the unnamed fallback in renderMeowMessage, not its own branch.
    const outsideCheck = [...comparedSet].filter((eventType) => !allowed.has(eventType)).sort();
    const unnamed = events.filter((eventType) => !comparedSet.has(eventType)).sort();
    expect({ outsideCheck, unnamed }).toEqual({ outsideCheck: [], unnamed: ['task.due'] });
  });

  it('web and mobile copy label every job type except index.sync', () => {
    // index.sync is an internal index heal with no user-facing label. Extra capability keys are allowed.
    const labeled = jobTypes.filter((jobType) => jobType !== 'index.sync');
    const sources: Array<[string, string]> = [
      ['apps/web/src/copy', webCopy],
      ['apps/mobile/src/lib/copy', mobileCopy],
    ];
    const maps = sources.map(([label, source]) => {
      const keys = new Set(objectKeysContaining(source, FOSSIL_JOB_TYPE));
      return {
        label,
        missing: labeled.filter((jobType) => !keys.has(jobType)).sort(),
      };
    });
    expect(maps).toEqual(maps.map(({ label }) => ({ label, missing: [] })));
  });
});
