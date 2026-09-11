import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type { Database } from '../../src/db/index.js';
import { agentActions, agentMemory, agentUsage, users } from '../../src/db/schema.js';

/** Fixed identity for the eval fixture — a dedicated user, cascade-deleted before every run. */
export const FIXTURE_USER_ID = '00000000-0000-4000-8000-0000000000e0';
export const FIXTURE_TZ = 'Asia/Shanghai';

/** Fixture moment: N days ago at 12:00 in the fixture timezone, so day buckets never straddle a boundary. */
export function fixtureTime(daysAgo: number): Date {
  return DateTime.now()
    .setZone(FIXTURE_TZ)
    .minus({ days: daysAgo })
    .startOf('day')
    .plus({ hours: 12 })
    .toJSDate();
}

/**
 * Deterministic feedback corpus. The fixed case the snapshot locks:
 * - one headline run → two proposals, both adopted (amortization case)
 * - one adopted + one undone decompose (undone never counts as adopted)
 * - a pending draft (proposed but no verdict)
 * - dismissed rows for the rate denominator
 */
const ACTIONS: {
  id: string;
  actionType: 'outcome.headline' | 'outcome.suggestion' | 'outcome.create' | 'task.decompose' | 'task.draft';
  feedback: 'pending' | 'accepted' | 'edited' | 'dismissed' | 'undone';
  daysAgo: number;
}[] = [
  { id: 'a1', actionType: 'outcome.headline', feedback: 'accepted', daysAgo: 0 },
  { id: 'a2', actionType: 'outcome.suggestion', feedback: 'edited', daysAgo: 0 },
  { id: 'a3', actionType: 'outcome.suggestion', feedback: 'dismissed', daysAgo: 1 },
  { id: 'a4', actionType: 'outcome.create', feedback: 'accepted', daysAgo: 1 },
  { id: 'a5', actionType: 'task.decompose', feedback: 'undone', daysAgo: 2 },
  { id: 'a6', actionType: 'task.decompose', feedback: 'accepted', daysAgo: 2 },
  { id: 'a7', actionType: 'task.draft', feedback: 'pending', daysAgo: 3 },
  { id: 'a8', actionType: 'outcome.headline', feedback: 'dismissed', daysAgo: 4 },
];

/** Usage ledger mirroring the runs that produced the actions above, plus unmapped cost (critic). */
const USAGE: { capability: string; costMicros: number | null; daysAgo: number }[] = [
  { capability: 'headline', costMicros: 400, daysAgo: 0 },
  { capability: 'headline', costMicros: 200, daysAgo: 1 },
  { capability: 'cluster', costMicros: 900, daysAgo: 1 },
  { capability: 'decompose', costMicros: 300, daysAgo: 2 },
  { capability: 'draft', costMicros: null, daysAgo: 3 }, // unknown model price
  { capability: 'draft', costMicros: 100, daysAgo: 3 },
  { capability: 'critic', costMicros: 150, daysAgo: 0 }, // no proposal mapping — must stay out of perCapability
];

export async function seedFixture(db: Database, opts: { tamper?: boolean } = {}): Promise<void> {
  const now = new Date();
  await db.insert(users).values({
    id: FIXTURE_USER_ID,
    email: 'eval-agent-fixture@test.local',
    passwordHash: 'eval-fixture-not-a-login',
    displayName: 'Eval Fixture',
    timezone: FIXTURE_TZ,
    createdAt: now,
    updatedAt: now,
  });
  const actions = opts.tamper
    ? ACTIONS.map((action) =>
        action.id === 'a1' ? { ...action, feedback: 'dismissed' as const } : action,
      )
    : ACTIONS;
  await db.insert(agentActions).values(
    actions.map((action) => ({
      id: randomUUID(),
      userId: FIXTURE_USER_ID,
      actionType: action.actionType,
      targetType: action.actionType.startsWith('outcome') ? 'outcome' : 'task',
      targetId: randomUUID(),
      payload: {},
      feedback: action.feedback,
      createdAt: fixtureTime(action.daysAgo),
    })),
  );
  await db.insert(agentUsage).values(
    USAGE.map((usage) => ({
      id: randomUUID(),
      userId: FIXTURE_USER_ID,
      capability: usage.capability,
      model: 'faux-1',
      promptTokens: 100,
      completionTokens: 50,
      costMicros: usage.costMicros,
      createdAt: fixtureTime(usage.daysAgo),
    })),
  );
  // Memory rows are part of the corpus for future recall metrics (batch 3) —
  // they do not influence the feedback-metric snapshot yet.
  await db.insert(agentMemory).values([
    {
      id: randomUUID(),
      userId: FIXTURE_USER_ID,
      kind: 'preference',
      content: '估时不要超过 30 分钟',
      scope: ['decompose', 'draft'],
      sourceCount: 3,
      manual: false,
      createdAt: fixtureTime(5),
      updatedAt: fixtureTime(5),
    },
    {
      id: randomUUID(),
      userId: FIXTURE_USER_ID,
      kind: 'correction',
      content: '线程命名用动宾短语',
      scope: ['cluster'],
      sourceCount: 1,
      manual: false,
      createdAt: fixtureTime(6),
      updatedAt: fixtureTime(6),
    },
  ]);
}
