import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { AppError } from '../../errors.js';
import { getDb } from '../../db/index.js';
import {
  agentJobs,
  inboxItemTags,
  inboxItems,
  tags,
  tasks,
  type AgentJobRow,
  type TaskRow,
  type User,
} from '../../db/schema.js';
import { resolveModelFor } from '../../llm/pi.js';
import { loadLlmStore } from '../../llm/store.js';
import { getInboxList } from '../../lists/lists.service.js';
import { createTaskInTx } from '../../tasks/tasks.write.js';
import { fireIndexTask } from '../../tasks/tasks.shared.js';
import { recordAgentAction } from '../action-ledger.js';
import { executionResult, skipExecution } from '../executions.service.js';
import { enqueueAgentJob } from '../jobs.js';
import { LostAgentJobLeaseError, withAgentJobEffects } from '../job-runtime.js';
import { lockAgentUser } from '../user-lock.js';
import {
  ensureTag,
  finishTask,
  freshUser,
  lockTask,
  modelText,
  notifyRow,
  reindex,
  settleFailure,
} from './effects.js';
import {
  ERRAND_DONE_TITLE,
  ERRAND_JOB_TYPE,
  ORGANIZE_BATCH,
  appendErrandNote,
  errandOrganizeMarker,
  errandSourceMarker,
  errandWouldExceed,
  isErrandPayload,
  isModelError,
  organizeDedupKey,
  organizeModelCalls,
  parseOrganizePlan,
  type ErrandStart,
  type OrganizePlan,
} from './model.js';
import { liveInboxIds } from './store.js';

export async function enqueueOrganize(
  userId: string,
  ids: readonly string[],
  trigger: string,
  existingTaskId?: string,
): Promise<ErrandStart> {
  const live = await liveInboxIds(userId, ids);
  if (live.length === 0) throw AppError.of(404, 'NOT_FOUND');
  const list = await getInboxList(userId);
  const dedupKey = organizeDedupKey(userId, live);
  const indexed: { task: TaskRow | null } = { task: null };
  let taskId = '';
  let jobId: string | null = null;
  await getDb().transaction(async (tx) => {
    await lockAgentUser(tx, userId);
    const [job] = await tx
      .select()
      .from(agentJobs)
      .where(eq(agentJobs.dedupKey, dedupKey))
      .limit(1);
    let reuse: string | null = existingTaskId ?? null;
    if (!reuse && job && job.userId === userId && isErrandPayload(job.payload))
      reuse = job.payload.taskId;
    if (reuse) {
      const [task] = await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, reuse), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
        .limit(1);
      if (task && task.status !== 'canceled') taskId = task.id;
    }
    if (taskId === '') {
      indexed.task = await createTaskInTx(tx, userId, {
        title: '整理收集箱',
        listId: list.id,
        notes: live.map((id) => errandSourceMarker(id)).join('\n'),
      });
      taskId = indexed.task.id;
    }
    jobId = await enqueueAgentJob(tx, {
      userId,
      jobType: ERRAND_JOB_TYPE,
      dedupKey,
      scheduledAt: new Date(),
      payload: {
        taskId,
        kind: 'inbox.organize',
        inboxItemIds: live,
        trigger,
      },
    });
  });
  if (indexed.task) fireIndexTask(indexed.task);
  return { taskId, jobId };
}

export async function startOrganizeErrand(
  userId: string,
  inboxItemIds: readonly string[],
  trigger = 'chat',
): Promise<ErrandStart> {
  return enqueueOrganize(userId, inboxItemIds, trigger);
}

const ORGANIZE_SYSTEM =
  '你整理收集箱。只输出 JSON：{"note":"一句整理说明","items":[{"id":"...","archive":true,"addTags":["标签"]}]}。只能使用给出的 id。archive 为 true 表示归档。addTags 是要新增的标签名，不要删除已有标签。不要编造 id。';

interface OrganizeRow {
  id: string;
  title: string;
  excerpt: string | null;
  status: string;
  tags: string[];
}

async function loadOrganizeRows(userId: string, ids: readonly string[]): Promise<OrganizeRow[]> {
  const live = await liveInboxIds(userId, ids);
  if (live.length === 0) return [];
  const items = await getDb()
    .select({
      id: inboxItems.id,
      title: inboxItems.title,
      excerpt: inboxItems.excerpt,
      status: inboxItems.status,
    })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, userId),
        inArray(inboxItems.id, live),
        isNull(inboxItems.deletedAt),
      ),
    );
  const links = await getDb()
    .select({ inboxItemId: inboxItemTags.inboxItemId, name: tags.name })
    .from(inboxItemTags)
    .innerJoin(tags, eq(tags.id, inboxItemTags.tagId))
    .where(inArray(inboxItemTags.inboxItemId, live));
  const byItem = new Map<string, string[]>();
  for (const link of links) {
    const list = byItem.get(link.inboxItemId) ?? [];
    list.push(link.name);
    byItem.set(link.inboxItemId, list);
  }
  const order = new Map(live.map((id, index) => [id, index]));
  return items
    .map((item) => ({ ...item, tags: byItem.get(item.id) ?? [] }))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

function organizePrompt(rows: readonly OrganizeRow[]): string {
  const lines = rows.map((row) => {
    const excerpt = (row.excerpt ?? '').replace(/\s+/g, ' ').slice(0, 80);
    const tag = row.tags.length > 0 ? row.tags.join('、') : '无';
    return `- id=${row.id} status=${row.status} tags=${tag} title=${row.title}${excerpt === '' ? '' : ` excerpt=${excerpt}`}`;
  });
  return lines.join('\n');
}

export async function processOrganize(
  job: AgentJobRow,
  user: User,
  task: TaskRow,
  ids: readonly string[],
  now: Date,
): Promise<'done'> {
  const marker = errandOrganizeMarker(task.id);
  const deeplink = '/inbox';
  if (task.notesMd.includes(marker)) {
    skipExecution('ALREADY_APPLIED');
    return 'done';
  }
  const rows = await loadOrganizeRows(user.id, ids);
  if (rows.length === 0) {
    await settleFailure(job, user, task.id, 'no-items', now, { kind: 'inbox.organize', deeplink });
    return 'done';
  }
  const needed = organizeModelCalls(rows.length);
  if (resolveModelFor(await loadLlmStore(user.id), 'agent.errand') === null) {
    await settleFailure(job, user, task.id, 'no-model', now, { kind: 'inbox.organize', deeplink });
    return 'done';
  }
  if (errandWouldExceed(needed)) {
    await settleFailure(job, user, task.id, 'propose', now, { kind: 'inbox.organize', deeplink });
    return 'done';
  }
  const plans: OrganizePlan[] = [];
  try {
    for (let offset = 0; offset < rows.length; offset += ORGANIZE_BATCH) {
      const batch = rows.slice(offset, offset + ORGANIZE_BATCH);
      const allowed = new Set(batch.map((row) => row.id));
      const raw = await modelText(user, ORGANIZE_SYSTEM, organizePrompt(batch), true);
      if (raw === null) {
        await settleFailure(job, user, task.id, 'no-model', now, {
          kind: 'inbox.organize',
          deeplink,
        });
        return 'done';
      }
      const plan = parseOrganizePlan(raw, allowed);
      if (!plan) {
        await settleFailure(job, user, task.id, 'bad-plan', now, {
          kind: 'inbox.organize',
          deeplink,
        });
        return 'done';
      }
      plans.push(plan);
    }
  } catch (err) {
    if (err instanceof LostAgentJobLeaseError) throw err;
    if (!isModelError(err)) throw err;
    await settleFailure(job, user, task.id, 'model-failed', now, {
      kind: 'inbox.organize',
      deeplink,
    });
    return 'done';
  }
  const note = plans
    .map((plan) => plan.note)
    .filter((line) => line !== '')
    .join('\n')
    .slice(0, 2000);
  const actions = plans.flatMap((plan) => plan.items);
  const explanation = note !== '' ? note : '已按条目归档或打上标签。';
  await withAgentJobEffects(job, async (tx) => {
    const current = await lockTask(tx, user.id, task.id);
    if (!current || current.status === 'canceled' || current.notesMd.includes(marker)) return;
    const notes = appendErrandNote(current.notesMd, marker, `代办 · 已整理\n${explanation}`);
    if (notes === null) return;
    const fresh = await freshUser(tx, user.id);
    if (!fresh) return;
    const tagCache = new Map<string, string>();
    for (const action of actions) {
      if (action.archive) {
        await tx
          .update(inboxItems)
          .set({ status: 'archived', updatedAt: now })
          .where(
            and(
              eq(inboxItems.id, action.id),
              eq(inboxItems.userId, user.id),
              isNull(inboxItems.deletedAt),
              inArray(inboxItems.status, ['unread', 'later']),
            ),
          );
      }
      if (action.addTags.length === 0) continue;
      const tagIds: string[] = [];
      for (const name of action.addTags) {
        const key = name.toLowerCase();
        let id = tagCache.get(key);
        if (!id) {
          const created = await ensureTag(tx, user.id, name, now);
          if (!created) continue;
          id = created;
          tagCache.set(key, id);
        }
        tagIds.push(id);
      }
      if (tagIds.length === 0) continue;
      const existing = await tx
        .select({ tagId: inboxItemTags.tagId })
        .from(inboxItemTags)
        .where(eq(inboxItemTags.inboxItemId, action.id));
      const have = new Set(existing.map((row) => row.tagId));
      const missing = tagIds.filter((id) => !have.has(id));
      if (missing.length > 0) {
        await tx
          .insert(inboxItemTags)
          .values(missing.map((tagId) => ({ inboxItemId: action.id, tagId })));
      }
    }
    await finishTask(tx, fresh, current, notes, now);
    await recordAgentAction(tx, {
      id: randomUUID(),
      userId: user.id,
      jobId: job.id,
      actionType: 'errand.organize',
      targetType: 'task',
      targetId: current.id,
      payload: {
        ok: true,
        kind: 'inbox.organize',
        inboxItemIds: rows.map((row) => row.id),
        note: explanation,
      },
      feedback: 'accepted',
      createdAt: now,
    });
    await notifyRow(tx, fresh, current, now, {
      title: ERRAND_DONE_TITLE,
      message: explanation,
      deeplink,
      key: `agent.errand:${fresh.id}:${current.id}:inbox.organize:done`,
    });
  });
  await reindex(
    task.id,
    user.id,
    rows.map((row) => row.id),
  );
  executionResult({ resultSummary: `已整理 ${String(rows.length)} 篇` });
  return 'done';
}
