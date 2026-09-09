/* eslint-disable @typescript-eslint/no-non-null-assertion -- test row assertions */
import { randomUUID } from 'node:crypto';
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreateAgentMemoryInput, PatchAgentMemoryInput } from '@vital/dto';
import { loadAgentMemory } from '../../src/agent/harness.js';
import { enqueueAgentJob, processDueAgentJobs } from '../../src/agent/jobs.js';
import {
  createAgentMemory,
  patchAgentMemory,
} from '../../src/agent/memory.service.js';
import { buildDistillPrompt } from '../../src/agent/prompts.js';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { agentActions, agentJobs, agentMemory } from '../../src/db/schema.js';
import { setPiResolveOverride } from '../../src/llm/pi.js';
import { resetDb } from '../helpers/db.js';
import { injectJson } from '../helpers/http.js';
import { registerUser } from '../helpers/session.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(resetDb);

afterEach(() => {
  setPiResolveOverride(null);
});

afterAll(async () => {
  await app.close();
});

/** Route every resolution to a scriptable faux provider (mirror of harness.test.ts). */
function installFaux() {
  const faux = fauxProvider({ provider: 'faux', models: [{ id: 'faux-1' }] });
  setPiResolveOverride((stored, route, apiKey) => {
    const models = createModels();
    models.setProvider(faux.provider);
    const model = models.getModel('faux', route.model);
    if (!model) return null;
    return { models, model, apiKey, route, stored };
  });
  return faux;
}

async function setupFauxUser(name: string): Promise<{ id: string; token: string }> {
  const user = await registerUser(app, name);
  const added = await injectJson(app, {
    method: 'POST',
    url: '/api/v1/llm/providers',
    token: user.token,
    payload: {
      providerId: 'custom',
      label: '测试网关',
      baseUrl: 'http://faux.test/v1',
      apiKey: 'sk-secret',
      models: ['faux-1'],
    },
  });
  expect(added.statusCode).toBe(200);
  const providerId = added.json().providers[0].id as string;
  const routed = await injectJson(app, {
    method: 'PUT',
    url: '/api/v1/llm/routing',
    token: user.token,
    payload: { routing: { default: { providerId, model: 'faux-1' } } },
  });
  expect(routed.statusCode).toBe(200);
  return user;
}

async function insertMemory(
  userId: string,
  opts: { kind?: string; content: string; manual?: boolean; scope?: string[]; createdAt?: Date },
): Promise<string> {
  const id = randomUUID();
  const createdAt = opts.createdAt ?? new Date();
  await getDb().insert(agentMemory).values({
    id,
    userId,
    kind: opts.kind ?? 'preference',
    content: opts.content,
    manual: opts.manual ?? false,
    scope: opts.scope ?? ['all'],
    createdAt,
    updatedAt: createdAt,
  });
  return id;
}

/** Distill only fires with ≥3 feedback rows inside the window. */
async function seedFeedback(userId: string, n = 3): Promise<void> {
  for (let i = 0; i < n; i++) {
    await getDb().insert(agentActions).values({
      id: randomUUID(),
      userId,
      jobId: null,
      actionType: 'outcome.headline',
      targetType: 'outcome',
      targetId: randomUUID(),
      payload: { headline: '提案' },
      feedback: i === 0 ? 'accepted' : i === 1 ? 'edited' : 'dismissed',
      createdAt: new Date(),
    });
  }
}

async function runDistill(userId: string): Promise<void> {
  await enqueueAgentJob(getDb(), {
    userId,
    jobType: 'memory.distill',
    payload: { date: '2026-W37' },
    dedupKey: `memory.distill:${userId}:2026-W37`,
    scheduledAt: new Date(Date.now() - 1_000),
  });
  const n = await processDueAgentJobs(new Date());
  expect(n).toBe(1);
  const [job] = await getDb()
    .select()
    .from(agentJobs)
    .where(eq(agentJobs.userId, userId));
  expect(job!.jobType).toBe('memory.distill');
  expect(job!.status).toBe('done');
  expect(job!.lastError).toBeNull();
}

describe('memory distill governance', () => {
  it('applies the operation stream: update rewrites, drop evicts, add appends; manual and foreign rows are untouchable', async () => {
    const alice = await setupFauxUser('alice');
    const bob = await registerUser(app, 'bob');
    const faux = installFaux();

    const keepId = await insertMemory(alice.id, { content: '保留：估时不超过 30 分钟' });
    const updateId = await insertMemory(alice.id, { content: '旧表述' });
    const dropId = await insertMemory(alice.id, { content: '过时的记忆' });
    const manualId = await insertMemory(alice.id, {
      kind: 'correction',
      content: '用户手写：不要用「冲刺」',
      manual: true,
    });
    const bobId = await insertMemory(bob.id, { content: 'bob 的记忆' });
    await seedFeedback(alice.id);

    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('submit_memories', {
          keep: [keepId, manualId],
          update: [{ id: updateId, content: '合并后的表述' }],
          add: [{ kind: 'pattern', content: '新蒸馏的模式', scope: ['cluster'] }],
          drop: [dropId, manualId, bobId],
        }),
      ),
    ]);
    await runDistill(alice.id);

    const rows = await getDb().select().from(agentMemory).where(eq(agentMemory.userId, alice.id));
    const byContent = new Map(rows.map((r) => [r.content, r]));

    // update applied
    expect(byContent.get('合并后的表述')?.id).toBe(updateId);
    expect(byContent.has('旧表述')).toBe(false);
    // drop applied (own non-manual row)
    expect(byContent.has('过时的记忆')).toBe(false);
    // manual row survived both the drop list and the 30-cap
    expect(byContent.get('用户手写：不要用「冲刺」')?.id).toBe(manualId);
    expect(byContent.get('用户手写：不要用「冲刺」')?.manual).toBe(true);
    // keep row untouched
    expect(byContent.has('保留：估时不超过 30 分钟')).toBe(true);
    // add applied with scope
    const added = byContent.get('新蒸馏的模式')!;
    expect(added.kind).toBe('pattern');
    expect(added.scope).toEqual(['cluster']);
    expect(added.sourceCount).toBe(3);
    expect(added.manual).toBe(false);

    // Foreign row untouched (model cannot drop another user's memory).
    const bobRows = await getDb().select().from(agentMemory).where(eq(agentMemory.userId, bob.id));
    expect(bobRows).toHaveLength(1);
    expect(bobRows[0]!.id).toBe(bobId);
  });

  it('caps the total at 30 by evicting the oldest non-manual rows', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    await seedFeedback(alice.id);

    // Oldest row is manual: it must survive the cap. 29 non-manual rows follow,
    // each a minute apart, oldest first.
    const base = Date.now() - 60 * 60_000;
    const manualId = await insertMemory(alice.id, {
      content: '手写最老',
      manual: true,
      createdAt: new Date(base),
    });
    const oldestIds: string[] = [];
    for (let i = 0; i < 29; i++) {
      const id = await insertMemory(alice.id, {
        content: `自动记忆 ${String(i).padStart(2, '0')}`,
        createdAt: new Date(base + (i + 1) * 60_000),
      });
      oldestIds.push(id);
    }

    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('submit_memories', {
          add: [
            { kind: 'preference', content: '新增一' },
            { kind: 'pattern', content: '新增二' },
          ],
        }),
      ),
    ]);
    await runDistill(alice.id);

    const rows = await getDb().select().from(agentMemory).where(eq(agentMemory.userId, alice.id));
    expect(rows).toHaveLength(30);
    const ids = new Set(rows.map((r) => r.id));
    // Manual oldest survives even though it predates every evicted row.
    expect(ids.has(manualId)).toBe(true);
    // The two oldest non-manual rows were evicted.
    expect(ids.has(oldestIds[0]!)).toBe(false);
    expect(ids.has(oldestIds[1]!)).toBe(false);
    expect(ids.has(oldestIds[2]!)).toBe(true);
    expect(ids.has(oldestIds[28]!)).toBe(true);
    // Both new rows landed.
    const contents = rows.map((r) => r.content);
    expect(contents).toContain('新增一');
    expect(contents).toContain('新增二');
  });

  it('returns done without touching memory when the model proposes no operations', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    await insertMemory(alice.id, { content: '保持不动' });
    await seedFeedback(alice.id);

    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('submit_memories', { keep: [], update: [], add: [], drop: [] })),
    ]);
    await runDistill(alice.id);

    const rows = await getDb().select().from(agentMemory).where(eq(agentMemory.userId, alice.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toBe('保持不动');
  });
});

describe('loadAgentMemory scope filter', () => {
  it('injects only rows whose scope matches the capability', async () => {
    const alice = await registerUser(app, 'alice');
    await insertMemory(alice.id, { content: '全局记忆', scope: ['all'] });
    await insertMemory(alice.id, { content: '聚类记忆', scope: ['cluster'] });
    await insertMemory(alice.id, { content: '双域记忆', scope: ['headline', 'cluster'] });

    const headline = await loadAgentMemory(alice.id, 'headline');
    expect(headline.map((m) => m.content).sort()).toEqual(['全局记忆', '双域记忆']);

    const cluster = await loadAgentMemory(alice.id, 'cluster');
    expect(cluster.map((m) => m.content).sort()).toEqual(['全局记忆', '双域记忆', '聚类记忆']);

    const decompose = await loadAgentMemory(alice.id, 'decompose');
    expect(decompose.map((m) => m.content)).toEqual(['全局记忆']);

    // No capability → everything (distill and observe paths).
    const all = await loadAgentMemory(alice.id);
    expect(all).toHaveLength(3);
  });
});

describe('buildDistillPrompt governance semantics', () => {
  it('marks manual rows as user-written and protected', () => {
    const { system, user } = buildDistillPrompt({
      actions: [
        {
          actionType: 'outcome.headline',
          feedback: 'edited',
          summary: '{"headline":"提案"}',
          editedSummary: '{"headline":"用户改的"}',
        },
      ],
      existingMemory: [
        { id: 'm1', kind: 'correction', content: '不要用「冲刺」', manual: true, scope: ['all'] },
        { id: 'm2', kind: 'pattern', content: '周末不排任务', manual: false, scope: ['cluster'] },
      ],
    });
    expect(system).toContain('update');
    expect(system).toContain('drop');
    expect(system).toContain('不得 update 或 drop');
    expect(system).toContain('submit_memories');
    expect(system).toContain('<data>');
    // Manual row carries the protection label; both rows expose their id.
    expect(user).toContain('id=m1');
    expect(user).toContain('（用户手写，最高优先级，不得 update/drop）');
    expect(user).not.toContain('id=m2（用户手写');
    expect(user).toContain('id=m2');
    expect(user).toContain('适用范围：cluster');
  });
});

describe('agent memory CRUD (settings memory tab)', () => {
  it('creates a manual row with defaults, lists newest-first, patches and deletes', async () => {
    const alice = await registerUser(app, 'alice');

    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/agent/memory',
      token: alice.token,
      payload: { kind: 'correction', content: '  不要用「冲刺」这个词  ' },
    });
    expect(created.statusCode).toBe(201);
    const row = created.json();
    expect(row.kind).toBe('correction');
    expect(row.content).toBe('不要用「冲刺」这个词'); // trimmed
    expect(row.manual).toBe(true); // user-written rows are distill-protected
    expect(row.sourceCount).toBe(0);
    expect(row.scope).toEqual(['all']); // default scope

    const olderId = await insertMemory(alice.id, {
      content: '自动蒸馏的记忆',
      createdAt: new Date(Date.now() - 60_000),
    });

    const listed = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/agent/memory',
      token: alice.token,
    });
    expect(listed.statusCode).toBe(200);
    const items = listed.json();
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe(row.id); // newest first
    expect(items[1].id).toBe(olderId);

    const patched = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/agent/memory/${row.id}`,
      token: alice.token,
      payload: { content: '措辞改一下', scope: ['headline', 'cluster'] },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().content).toBe('措辞改一下');
    // Order is not part of the contract; membership is.
    expect(new Set(patched.json().scope)).toEqual(new Set(['headline', 'cluster']));

    const deleted = await injectJson(app, {
      method: 'DELETE',
      url: `/api/v1/agent/memory/${olderId}`,
      token: alice.token,
    });
    expect(deleted.statusCode).toBe(204);
    const remaining = await getDb().select().from(agentMemory).where(eq(agentMemory.userId, alice.id));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(row.id);
  });

  it('rejects empty patches and enforces ownership (404 across users)', async () => {
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    const aliceId = await insertMemory(alice.id, { content: 'alice 的记忆' });

    const emptyPatch = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/agent/memory/${aliceId}`,
      token: alice.token,
      payload: {},
    });
    expect(emptyPatch.statusCode).toBe(400);

    const foreignPatch = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/agent/memory/${aliceId}`,
      token: bob.token,
      payload: { content: '篡改' },
    });
    expect(foreignPatch.statusCode).toBe(404);

    const foreignDelete = await injectJson(app, {
      method: 'DELETE',
      url: `/api/v1/agent/memory/${aliceId}`,
      token: bob.token,
    });
    expect(foreignDelete.statusCode).toBe(404);
    // The row survived both foreign attempts.
    const rows = await getDb().select().from(agentMemory).where(eq(agentMemory.id, aliceId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toBe('alice 的记忆');
  });

  it('sanitizes scope before writing: illegal values dropped, empty or all-including collapses to ["all"]', async () => {
    const alice = await registerUser(app, 'alice');
    // Bypass the zod boundary on purpose: sanitize is defense in depth for internal callers.
    const illegal = await createAgentMemory(alice.id, {
      kind: 'preference',
      content: '混入非法值',
      scope: ['cluster', 'nonsense', 'cluster', ''] as unknown as CreateAgentMemoryInput['scope'],
    });
    expect(illegal.scope).toEqual(['cluster']);

    const everything = await createAgentMemory(alice.id, {
      kind: 'pattern',
      content: '含 all 的组合',
      scope: ['all', 'headline'] as unknown as CreateAgentMemoryInput['scope'],
    });
    expect(everything.scope).toEqual(['all']);

    const emptied = await patchAgentMemory(alice.id, illegal.id, {
      scope: ['bogus'] as unknown as PatchAgentMemoryInput['scope'],
    });
    expect(emptied.scope).toEqual(['all']);
  });
});
