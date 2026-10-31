import { createHash, randomUUID } from 'node:crypto';
import type {
  ExplorationConfirmInput,
  ExplorationFactStatus,
  ExplorationGenerateInput,
  ExplorationProposal,
  ExplorationProposalContent,
  ExplorationProposalStatus,
  ExplorationSelectInput,
  ExplorationVerification,
  ExplorationVerifyStage,
  ExplorationWindow,
  ExplorationWindowDetail,
} from '@vital/dto';
import { and, asc, desc, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { getUserEntity } from '../auth/auth.service.js';
import { getDb, type Database } from '../db/index.js';
import { isUniqueViolation } from '../db/pg.js';
import {
  explorationProposals,
  explorationVerifications,
  explorationWindows,
  type ExplorationProposalRow,
  type ExplorationVerificationRow,
  type ExplorationWindowRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { getInboxList } from '../lists/lists.service.js';
import { createTaskInTx } from '../tasks/tasks.write.js';
import { fireIndexTask } from '../tasks/tasks.shared.js';
import {
  getFactsAdapter,
  unknownFact,
  type ActivityFact,
  type FactsProposal,
} from './facts-adapter.js';
import { FIXTURE_LEAVE_FREE_TIME } from './facts-adapter.fixture.js';
import { plusHours, zonedDateTime } from './rules/clock.js';

export const MAX_PROPOSALS_PER_WINDOW = 3;
export const REJECT_COOLDOWN_DAYS = 90;
export const CONFIRM_IDEMPOTENCY_PREFIX = 'exploration.confirm:';
const FACTS_TIMEOUT_MS = 1_500;
const MATERIAL_FIELDS = new Set(['weather', 'hours', 'price', 'reservation', 'open']);
const CITY_PROMPT = '这次空闲会在哪座城市？';
const ACTIVITY_WORDS = ['散步', '博物馆', '电影', '野餐', '图书馆'];

type ExplorationTx = Pick<Database, 'insert' | 'update' | 'delete' | 'select'>;

const EMPTY_CONTENT: ExplorationProposalContent = {
  title: '',
  reason: '',
  experience: '',
  timeCost: '',
  moneyRange: '待核实',
  companions: '',
  source: '',
  fetchedAt: '',
  cancelPolicy: '',
  alternative: '',
  direction: 'familiar',
  leaveFreeTime: FIXTURE_LEAVE_FREE_TIME,
};

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function placeKey(place: string | null | undefined): string {
  return (place ?? '').trim();
}

function confirmKey(proposalId: string, explicit?: string): string {
  return explicit ?? `${CONFIRM_IDEMPOTENCY_PREFIX}${proposalId}`;
}

function fingerprintOf(fact: Pick<ActivityFact, 'field' | 'value'>): string {
  return createHash('sha256').update(JSON.stringify({ field: fact.field, value: fact.value })).digest('hex').slice(0, 32);
}

function contentOf(raw: unknown): ExplorationProposalContent {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_CONTENT };
  const row = raw as Partial<ExplorationProposalContent>;
  return {
    title: typeof row.title === 'string' ? row.title : EMPTY_CONTENT.title,
    reason: typeof row.reason === 'string' ? row.reason : EMPTY_CONTENT.reason,
    experience: typeof row.experience === 'string' ? row.experience : EMPTY_CONTENT.experience,
    timeCost: typeof row.timeCost === 'string' ? row.timeCost : EMPTY_CONTENT.timeCost,
    moneyRange: typeof row.moneyRange === 'string' ? row.moneyRange : EMPTY_CONTENT.moneyRange,
    companions: typeof row.companions === 'string' ? row.companions : EMPTY_CONTENT.companions,
    source: typeof row.source === 'string' ? row.source : EMPTY_CONTENT.source,
    fetchedAt: typeof row.fetchedAt === 'string' ? row.fetchedAt : EMPTY_CONTENT.fetchedAt,
    cancelPolicy: typeof row.cancelPolicy === 'string' ? row.cancelPolicy : EMPTY_CONTENT.cancelPolicy,
    alternative: typeof row.alternative === 'string' ? row.alternative : EMPTY_CONTENT.alternative,
    direction:
      row.direction === 'familiar' || row.direction === 'new' || row.direction === 'low_energy'
        ? row.direction
        : EMPTY_CONTENT.direction,
    leaveFreeTime: typeof row.leaveFreeTime === 'string' ? row.leaveFreeTime : EMPTY_CONTENT.leaveFreeTime,
  };
}

function windowToDto(row: ExplorationWindowRow): ExplorationWindow {
  return {
    id: row.id,
    windowKey: row.windowKey,
    startDate: row.startDate,
    endDate: row.endDate,
    timezone: row.timezone,
    region: row.region ?? null,
    calendarVersion: row.calendarVersion,
    status: row.status,
    closedReason: row.closedReason ?? null,
    generatedAt: row.generatedAt.toISOString(),
  };
}

function verificationToDto(row: ExplorationVerificationRow): ExplorationVerification {
  return {
    id: row.id,
    proposalId: row.proposalId,
    stage: row.stage,
    field: row.field,
    value: row.value ?? null,
    url: row.url ?? null,
    fetchedAt: iso(row.fetchedAt),
    validUntil: iso(row.validUntil),
    status: row.status,
    diff: row.diff ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function proposalToDto(
  row: ExplorationProposalRow,
  verifications: ExplorationVerificationRow[],
): ExplorationProposal {
  return {
    id: row.id,
    windowId: row.windowId,
    activityKey: row.activityKey,
    status: row.status,
    interestReason: row.interestReason ?? null,
    content: contentOf(row.content),
    planId: row.planId ?? null,
    taskId: row.taskId ?? null,
    place: row.place ?? null,
    decisionDeadline: iso(row.decisionDeadline),
    departureAt: iso(row.departureAt),
    nextVerifyAt: iso(row.nextVerifyAt),
    rejectedAt: iso(row.rejectedAt),
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    verifications: latestByField(verifications).map(verificationToDto),
  };
}

function latestByField(rows: ExplorationVerificationRow[]): ExplorationVerificationRow[] {
  const map = new Map<string, ExplorationVerificationRow>();
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const row of sorted) map.set(row.field, row);
  return [...map.values()];
}

async function settleFacts<T>(op: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await Promise.race([
      op(),
      new Promise<T>((_, reject) => {
        setTimeout(() => {
          reject(new Error('facts timeout'));
        }, FACTS_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return fallback;
  }
}

function defaultDeparture(window: ExplorationWindowRow): Date {
  return zonedDateTime(window.startDate, '09:00', window.timezone);
}

function decisionDeadlineOf(departure: Date, now: Date): Date {
  const raw = plusHours(departure, -48);
  return raw.getTime() < now.getTime() ? now : raw;
}

function nextCheckpoint(
  decisionDeadline: Date | null,
  departureAt: Date | null,
  now: Date,
): { at: Date; stage: ExplorationVerifyStage } | null {
  if (decisionDeadline && now.getTime() < decisionDeadline.getTime()) {
    return { at: decisionDeadline, stage: 'decision' };
  }
  if (!departureAt) return null;
  const windowStart = plusHours(departureAt, -24);
  if (now.getTime() >= departureAt.getTime()) return null;
  if (now.getTime() >= windowStart.getTime()) return { at: now, stage: 'departure' };
  return { at: windowStart, stage: 'departure' };
}

function inferStage(
  decisionDeadline: Date | null,
  departureAt: Date | null,
  now: Date,
): ExplorationVerifyStage {
  const next = nextCheckpoint(decisionDeadline, departureAt, now);
  if (next?.stage === 'departure') return 'departure';
  if (decisionDeadline && now.getTime() >= decisionDeadline.getTime()) return 'decision';
  return 'decision';
}

function locationFreeFallback(place: string | null, now: Date): FactsProposal[] {
  const fetchedAt = now.toISOString();
  const blankFacts: ActivityFact[] = ['hours', 'price', 'reservation'].map((field) => unknownFact(field, now));
  return [
    {
      activityKey: 'neighborhood_stroll',
      title: '熟悉街区慢走',
      place,
      reason: `从日常散步延伸一点。${FIXTURE_LEAVE_FREE_TIME}`,
      experience: '在住处附近慢慢走一圈，不赶路。',
      timeCost: '约 1.5 小时',
      moneyRange: '待核实',
      companions: '独自或家人',
      source: '',
      cancelPolicy: '随时取消。',
      alternative: '下雨改成在家电影。',
      direction: 'familiar',
      facts: blankFacts,
    },
    {
      activityKey: 'local_library_browse',
      title: '去图书馆随便翻',
      place,
      reason: `换一个安静公共空间。${FIXTURE_LEAVE_FREE_TIME}`,
      experience: '在附近图书馆或书店坐一会儿。',
      timeCost: '约 2 小时',
      moneyRange: '待核实',
      companions: '适合独自',
      source: '',
      cancelPolicy: '无需预约。',
      alternative: '闭馆则在家听书。',
      direction: 'new',
      facts: blankFacts.map((row) => ({ ...row, fetchedAt })),
    },
    {
      activityKey: 'home_film_afternoon',
      title: '在家下午电影',
      place,
      reason: `低精力选项。${FIXTURE_LEAVE_FREE_TIME}`,
      experience: '选一部都能看下去的片子。',
      timeCost: '约 2.5 小时',
      moneyRange: '待核实',
      companions: '家人或独自',
      source: '',
      cancelPolicy: '随时停下。',
      alternative: '没精神就午睡。',
      direction: 'low_energy',
      facts: blankFacts.map((row) => ({ ...row, fetchedAt })),
    },
  ];
}

async function searchProposals(place: string | null, dates: string[], now: Date): Promise<FactsProposal[]> {
  const adapter = getFactsAdapter();
  const hits = await settleFacts(
    () => adapter.search({ place, dates, activityWords: ACTIVITY_WORDS }),
    [],
  );
  if (hits.length > 0) return hits.slice(0, MAX_PROPOSALS_PER_WINDOW);
  return locationFreeFallback(place, now);
}

async function loadFacts(
  activityKey: string,
  when: string,
  place: string | null,
  dateYmd: string,
  now: Date,
): Promise<ActivityFact[]> {
  const adapter = getFactsAdapter();
  const activity = await settleFacts(
    () => adapter.verifyActivity(activityKey, when, place),
    [unknownFact('hours', now), unknownFact('price', now), unknownFact('reservation', now)],
  );
  const weather = await settleFacts(() => adapter.weather(place, dateYmd), unknownFact('weather', now));
  const byField = new Map<string, ActivityFact>();
  for (const fact of activity) byField.set(fact.field, fact);
  byField.set('weather', weather);
  return [...byField.values()];
}

async function loadOwnedWindow(
  tx: ExplorationTx,
  userId: string,
  id: string,
  forUpdate: boolean,
): Promise<ExplorationWindowRow> {
  const base = tx
    .select()
    .from(explorationWindows)
    .where(and(eq(explorationWindows.id, id), eq(explorationWindows.userId, userId)))
    .limit(1);
  const [row] = forUpdate ? await base.for('update') : await base;
  if (!row) throw AppError.of(404, 'NOT_FOUND');
  return row;
}

async function loadOwnedProposal(
  tx: ExplorationTx,
  userId: string,
  id: string,
  forUpdate: boolean,
): Promise<ExplorationProposalRow> {
  const base = tx
    .select()
    .from(explorationProposals)
    .where(and(eq(explorationProposals.id, id), eq(explorationProposals.userId, userId)))
    .limit(1);
  const [row] = forUpdate ? await base.for('update') : await base;
  if (!row) throw AppError.of(404, 'NOT_FOUND');
  return row;
}

async function rejectedKeys(
  tx: ExplorationTx,
  userId: string,
  now: Date,
): Promise<Set<string>> {
  const cutoff = DateTime.fromJSDate(now).minus({ days: REJECT_COOLDOWN_DAYS }).toJSDate();
  const rows = await tx
    .select({
      activityKey: explorationProposals.activityKey,
      place: explorationProposals.place,
    })
    .from(explorationProposals)
    .where(
      and(
        eq(explorationProposals.userId, userId),
        isNotNull(explorationProposals.rejectedAt),
        gte(explorationProposals.rejectedAt, cutoff),
      ),
    );
  return new Set(rows.map((row) => `${row.activityKey}::${placeKey(row.place)}`));
}

async function loadVerifications(
  tx: ExplorationTx,
  userId: string,
  proposalIds: readonly string[],
): Promise<Map<string, ExplorationVerificationRow[]>> {
  const map = new Map<string, ExplorationVerificationRow[]>();
  for (const id of proposalIds) map.set(id, []);
  if (proposalIds.length === 0) return map;
  const rows = await tx
    .select()
    .from(explorationVerifications)
    .where(
      and(
        eq(explorationVerifications.userId, userId),
        inArray(explorationVerifications.proposalId, [...proposalIds]),
      ),
    )
    .orderBy(desc(explorationVerifications.createdAt));
  for (const row of rows) {
    const list = map.get(row.proposalId);
    if (list) list.push(row);
  }
  return map;
}

async function recordFacts(
  tx: ExplorationTx,
  input: {
    userId: string;
    proposalId: string;
    stage: ExplorationVerifyStage;
    facts: ActivityFact[];
    previous: ExplorationVerificationRow[];
    now: Date;
  },
): Promise<void> {
  const previousByField = new Map<string, ExplorationVerificationRow>();
  const sorted = [...input.previous].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const row of sorted) previousByField.set(row.field, row);

  for (const fact of input.facts) {
    const fp = fingerprintOf(fact);
    const prev = previousByField.get(fact.field);
    if (prev?.fingerprint === fp) continue;
    let status: ExplorationFactStatus = fact.status === 'verified' ? 'verified' : 'unknown';
    let diff: unknown = null;
    if (
      prev &&
      MATERIAL_FIELDS.has(fact.field) &&
      prev.fingerprint &&
      prev.fingerprint !== fp &&
      (prev.status === 'verified' || prev.status === 'changed')
    ) {
      status = 'changed';
      diff = { before: prev.value, after: fact.value };
    }
    await tx.insert(explorationVerifications).values({
      id: randomUUID(),
      userId: input.userId,
      proposalId: input.proposalId,
      stage: input.stage,
      field: fact.field,
      value: fact.value ?? null,
      url: fact.url,
      fetchedAt: fact.fetchedAt ? new Date(fact.fetchedAt) : input.now,
      validUntil: fact.validUntil ? new Date(fact.validUntil) : null,
      status,
      diff,
      fingerprint: fp,
      createdAt: input.now,
    });
  }
}

function contentFromHit(hit: FactsProposal, now: Date): ExplorationProposalContent {
  return {
    title: hit.title,
    reason: hit.reason,
    experience: hit.experience,
    timeCost: hit.timeCost,
    moneyRange: hit.moneyRange,
    companions: hit.companions,
    source: hit.source,
    fetchedAt: now.toISOString(),
    cancelPolicy: hit.cancelPolicy,
    alternative: hit.alternative,
    direction: hit.direction,
    leaveFreeTime: FIXTURE_LEAVE_FREE_TIME,
  };
}

export async function insertFixtureProposals(
  tx: ExplorationTx,
  input: {
    userId: string;
    window: ExplorationWindowRow;
    now: Date;
    place?: string | null;
    reRequest?: boolean;
  },
): Promise<ExplorationProposalRow[]> {
  const [locked] = await tx
    .select()
    .from(explorationWindows)
    .where(
      and(eq(explorationWindows.id, input.window.id), eq(explorationWindows.userId, input.userId)),
    )
    .limit(1)
    .for('update');
  if (!locked || locked.status !== 'open') return [];

  const existing = await tx
    .select()
    .from(explorationProposals)
    .where(
      and(eq(explorationProposals.windowId, locked.id), eq(explorationProposals.userId, input.userId)),
    );
  if (existing.length >= MAX_PROPOSALS_PER_WINDOW) return existing;

  const taken = new Set(existing.map((row) => row.activityKey));
  const blocked = input.reRequest ? new Set<string>() : await rejectedKeys(tx, input.userId, input.now);
  const dates = [locked.startDate, locked.endDate];
  const place = input.place?.trim() ? input.place.trim() : null;
  const hits = await searchProposals(place, dates, input.now);
  const picked: FactsProposal[] = [];
  const seenDirection = new Set(
    existing.filter((row) => row.status !== 'canceled').map((row) => contentOf(row.content).direction),
  );
  for (const hit of hits) {
    if (picked.length + existing.length >= MAX_PROPOSALS_PER_WINDOW) break;
    if (taken.has(hit.activityKey)) continue;
    const key = `${hit.activityKey}::${placeKey(hit.place ?? place)}`;
    if (blocked.has(key)) continue;
    if (seenDirection.has(hit.direction)) continue;
    picked.push(hit);
    seenDirection.add(hit.direction);
    taken.add(hit.activityKey);
  }
  if (picked.length === 0) return existing;

  const departure = defaultDeparture(locked);
  const decision = decisionDeadlineOf(departure, input.now);
  const next = nextCheckpoint(decision, departure, input.now);
  const inserted: ExplorationProposalRow[] = [...existing];
  for (const hit of picked) {
    const id = randomUUID();
    const content = contentFromHit(hit, input.now);
    const [row] = await tx
      .insert(explorationProposals)
      .values({
        id,
        userId: input.userId,
        windowId: locked.id,
        activityKey: hit.activityKey,
        status: 'proposed',
        interestReason: content.reason,
        content,
        planId: null,
        taskId: null,
        place: hit.place ?? place,
        decisionDeadline: decision,
        departureAt: departure,
        nextVerifyAt: next?.at ?? null,
        rejectedAt: null,
        confirmedAt: null,
        version: 1,
        idempotencyKey: null,
        createdAt: input.now,
      })
      .returning();
    if (!row) continue;
    inserted.push(row);
    const facts = hit.facts.length > 0 ? hit.facts : await loadFacts(
      hit.activityKey,
      locked.startDate,
      hit.place ?? place,
      locked.startDate,
      input.now,
    );
    const weather = facts.some((fact) => fact.field === 'weather')
      ? facts
      : [...facts, ...(await loadFacts(hit.activityKey, locked.startDate, hit.place ?? place, locked.startDate, input.now)).filter((f) => f.field === 'weather')];
    await recordFacts(tx, {
      userId: input.userId,
      proposalId: row.id,
      stage: 'initial',
      facts: weather,
      previous: [],
      now: input.now,
    });
  }
  return inserted;
}

async function attachDetail(
  tx: ExplorationTx,
  userId: string,
  window: ExplorationWindowRow,
): Promise<ExplorationWindowDetail> {
  const proposalRows = await tx
    .select()
    .from(explorationProposals)
    .where(and(eq(explorationProposals.windowId, window.id), eq(explorationProposals.userId, userId)))
    .orderBy(asc(explorationProposals.createdAt));
  const verifications = await loadVerifications(
    tx,
    userId,
    proposalRows.map((row) => row.id),
  );
  const live = proposalRows.filter((row) => row.status !== 'canceled');
  const missingPlace = live.every((row) => !row.place);
  return {
    ...windowToDto(window),
    proposals: proposalRows.map((row) => proposalToDto(row, verifications.get(row.id) ?? [])),
    cityPrompt: missingPlace && window.status === 'open' ? CITY_PROMPT : null,
  };
}

export async function generateWindowProposals(
  userId: string,
  windowId: string,
  input: ExplorationGenerateInput = {},
  now = new Date(),
): Promise<ExplorationWindowDetail> {
  await getUserEntity(userId);
  return getDb().transaction(async (tx) => {
    const window = await loadOwnedWindow(tx, userId, windowId, true);
    if (window.status === 'open') {
      await insertFixtureProposals(tx, {
        userId,
        window,
        now,
        place: input.place ?? null,
        reRequest: input.reRequest ?? false,
      });
    }
    const fresh = await loadOwnedWindow(tx, userId, windowId, false);
    return attachDetail(tx, userId, fresh);
  });
}

export async function getExplorationWindowDetail(
  userId: string,
  windowId: string,
  now = new Date(),
): Promise<ExplorationWindowDetail> {
  await getUserEntity(userId);
  return getDb().transaction(async (tx) => {
    const window = await loadOwnedWindow(tx, userId, windowId, true);
    if (window.status === 'open') {
      const existing = await tx
        .select({ id: explorationProposals.id })
        .from(explorationProposals)
        .where(
          and(eq(explorationProposals.windowId, window.id), eq(explorationProposals.userId, userId)),
        )
        .limit(1);
      if (existing.length === 0) {
        await insertFixtureProposals(tx, { userId, window, now, place: null });
      }
      await verifyDueForWindow(tx, userId, window.id, now);
    }
    const fresh = await loadOwnedWindow(tx, userId, windowId, false);
    return attachDetail(tx, userId, fresh);
  });
}

async function verifyProposalRow(
  tx: ExplorationTx,
  userId: string,
  proposal: ExplorationProposalRow,
  window: ExplorationWindowRow,
  stage: ExplorationVerifyStage,
  now: Date,
): Promise<ExplorationProposalRow> {
  const previous = await tx
    .select()
    .from(explorationVerifications)
    .where(
      and(eq(explorationVerifications.proposalId, proposal.id), eq(explorationVerifications.userId, userId)),
    );
  const when = proposal.departureAt
    ? DateTime.fromJSDate(proposal.departureAt).setZone(window.timezone).toISODate() ?? window.startDate
    : window.startDate;
  const facts = await loadFacts(proposal.activityKey, when, proposal.place ?? null, when, now);
  await recordFacts(tx, {
    userId,
    proposalId: proposal.id,
    stage,
    facts,
    previous,
    now,
  });
  const next = nextCheckpoint(proposal.decisionDeadline, proposal.departureAt, now);
  const [updated] = await tx
    .update(explorationProposals)
    .set({ nextVerifyAt: next?.at ?? null })
    .where(eq(explorationProposals.id, proposal.id))
    .returning();
  return updated ?? proposal;
}

async function verifyDueForWindow(
  tx: ExplorationTx,
  userId: string,
  windowId: string,
  now: Date,
): Promise<void> {
  const window = await loadOwnedWindow(tx, userId, windowId, false);
  const due = await tx
    .select()
    .from(explorationProposals)
    .where(
      and(
        eq(explorationProposals.userId, userId),
        eq(explorationProposals.windowId, windowId),
        lte(explorationProposals.nextVerifyAt, now),
      ),
    );
  for (const row of due) {
    if (row.status === 'canceled' || row.status === 'completed') continue;
    const stage = inferStage(row.decisionDeadline, row.departureAt, now);
    await verifyProposalRow(tx, userId, row, window, stage, now);
  }
}

function applySchedule(
  proposal: ExplorationProposalRow,
  window: ExplorationWindowRow,
  input: { place?: string | null | undefined; departureAt?: string | undefined },
  now: Date,
): { place: string | null; departureAt: Date; decisionDeadline: Date; version: number; changed: boolean } {
  const nextPlace =
    input.place !== undefined ? (input.place?.trim() ? input.place.trim() : null) : (proposal.place ?? null);
  const nextDeparture = input.departureAt
    ? new Date(input.departureAt)
    : (proposal.departureAt ?? defaultDeparture(window));
  const placeChanged = placeKey(nextPlace) !== placeKey(proposal.place);
  const departureChanged = (proposal.departureAt?.getTime() ?? 0) !== nextDeparture.getTime();
  const changed = placeChanged || departureChanged;
  return {
    place: nextPlace,
    departureAt: nextDeparture,
    decisionDeadline: decisionDeadlineOf(nextDeparture, now),
    version: changed ? proposal.version + 1 : proposal.version,
    changed,
  };
}

async function proposalDetail(
  tx: ExplorationTx,
  userId: string,
  proposal: ExplorationProposalRow,
): Promise<ExplorationProposal> {
  const verifications = await tx
    .select()
    .from(explorationVerifications)
    .where(
      and(eq(explorationVerifications.proposalId, proposal.id), eq(explorationVerifications.userId, userId)),
    );
  return proposalToDto(proposal, verifications);
}

export async function selectProposal(
  userId: string,
  proposalId: string,
  input: ExplorationSelectInput = {},
  now = new Date(),
): Promise<ExplorationProposal> {
  await getUserEntity(userId);
  return getDb().transaction(async (tx) => {
    const proposal = await loadOwnedProposal(tx, userId, proposalId, true);
    const window = await loadOwnedWindow(tx, userId, proposal.windowId, true);
    if (window.status === 'rest' || window.status === 'closed') {
      throw AppError.of(400, 'VALIDATION_ERROR');
    }
    if (proposal.status === 'canceled') throw AppError.of(400, 'VALIDATION_ERROR');
    const schedule = applySchedule(proposal, window, input, now);
    await tx
      .update(explorationProposals)
      .set({
        status: proposal.status === 'confirmed' ? 'confirmed' : 'verification_pending',
        place: schedule.place,
        departureAt: schedule.departureAt,
        decisionDeadline: schedule.decisionDeadline,
        version: schedule.version,
      })
      .where(eq(explorationProposals.id, proposal.id));
    const pending = await loadOwnedProposal(tx, userId, proposalId, true);
    await verifyProposalRow(tx, userId, pending, window, 'select', now);
    const nextStatus: ExplorationProposalStatus =
      pending.status === 'confirmed' ? 'confirmed' : 'draft_ready';
    const [updated] = await tx
      .update(explorationProposals)
      .set({ status: nextStatus })
      .where(eq(explorationProposals.id, proposal.id))
      .returning();
    if (!updated) throw AppError.of(404, 'NOT_FOUND');
    return proposalDetail(tx, userId, updated);
  });
}

function hasUnknownFacts(rows: ExplorationVerificationRow[]): boolean {
  return latestByField(rows).some((row) => row.status === 'unknown');
}

export async function confirmProposal(
  userId: string,
  proposalId: string,
  input: ExplorationConfirmInput = {},
  now = new Date(),
): Promise<ExplorationProposal> {
  await getUserEntity(userId);
  const key = confirmKey(proposalId, input.idempotencyKey);
  try {
    const { proposal, created } = await getDb().transaction(async (tx) => {
      const proposal = await loadOwnedProposal(tx, userId, proposalId, true);
      const window = await loadOwnedWindow(tx, userId, proposal.windowId, true);
      if (proposal.status === 'canceled') throw AppError.of(400, 'VALIDATION_ERROR');
      if (proposal.status === 'confirmed' && proposal.taskId) {
        return { proposal, created: null as Awaited<ReturnType<typeof createTaskInTx>> | null };
      }
      if (proposal.status === 'proposed') throw AppError.of(400, 'VALIDATION_ERROR');
      if (window.status === 'rest') throw AppError.of(400, 'VALIDATION_ERROR');

      const schedule = applySchedule(proposal, window, input, now);
      if (schedule.changed) {
        await tx
          .update(explorationProposals)
          .set({
            place: schedule.place,
            departureAt: schedule.departureAt,
            decisionDeadline: schedule.decisionDeadline,
            version: schedule.version,
          })
          .where(eq(explorationProposals.id, proposal.id));
      }
      const current = await loadOwnedProposal(tx, userId, proposalId, true);
      await verifyProposalRow(tx, userId, current, window, 'select', now);
      const facts = await tx
        .select()
        .from(explorationVerifications)
        .where(
          and(eq(explorationVerifications.proposalId, proposalId), eq(explorationVerifications.userId, userId)),
        );
      if (hasUnknownFacts(facts) && input.acceptUnknown !== true) {
        throw AppError.of(409, 'EXPLORATION_FACTS_UNKNOWN');
      }

      if (current.taskId) {
        const [updated] = await tx
          .update(explorationProposals)
          .set({
            status: 'confirmed',
            confirmedAt: current.confirmedAt ?? now,
            idempotencyKey: current.idempotencyKey ?? key,
          })
          .where(eq(explorationProposals.id, proposalId))
          .returning();
        return { proposal: updated ?? current, created: null };
      }

      const inbox = await getInboxList(userId);
      const content = contentOf(current.content);
      const dueYmd =
        DateTime.fromJSDate(current.departureAt ?? defaultDeparture(window))
          .setZone(window.timezone)
          .toISODate() ?? window.startDate;
      const unknownNote = hasUnknownFacts(facts) ? '\n\n部分事实待核实，已按你的确认写入计划。' : '';
      const created = await createTaskInTx(tx, userId, {
        title: content.title || current.activityKey,
        listId: inbox.id,
        notes: [
          content.experience,
          `时间：${content.timeCost}`,
          `费用：${content.moneyRange}`,
          `来源：${content.source || '待核实'}`,
          `取消：${content.cancelPolicy}`,
          content.leaveFreeTime,
        ]
          .filter(Boolean)
          .join('\n') + unknownNote,
        dueYmd,
        isAllDay: true,
        timezone: window.timezone,
      });
      const [updated] = await tx
        .update(explorationProposals)
        .set({
          status: 'confirmed',
          taskId: created.id,
          confirmedAt: now,
          idempotencyKey: key,
        })
        .where(eq(explorationProposals.id, proposalId))
        .returning();
      if (!updated) throw AppError.of(500, 'INTERNAL_ERROR');
      return { proposal: updated, created };
    });
    if (created) fireIndexTask(created);
    return await getDb().transaction(async (tx) => proposalDetail(tx, userId, proposal));
  } catch (err) {
    if (input.idempotencyKey && isUniqueViolation(err)) {
      const [row] = await getDb()
        .select()
        .from(explorationProposals)
        .where(
          and(eq(explorationProposals.userId, userId), eq(explorationProposals.idempotencyKey, key)),
        )
        .limit(1);
      if (row) {
        return await getDb().transaction(async (tx) => proposalDetail(tx, userId, row));
      }
    }
    if (isUniqueViolation(err)) {
      const [row] = await getDb()
        .select()
        .from(explorationProposals)
        .where(and(eq(explorationProposals.id, proposalId), eq(explorationProposals.userId, userId)))
        .limit(1);
      if (row?.taskId) {
        return await getDb().transaction(async (tx) => proposalDetail(tx, userId, row));
      }
    }
    throw err;
  }
}

export async function rejectProposal(
  userId: string,
  proposalId: string,
  now = new Date(),
): Promise<ExplorationProposal> {
  await getUserEntity(userId);
  return getDb().transaction(async (tx) => {
    const proposal = await loadOwnedProposal(tx, userId, proposalId, true);
    await loadOwnedWindow(tx, userId, proposal.windowId, true);
    if (proposal.status === 'confirmed') throw AppError.of(400, 'VALIDATION_ERROR');
    if (proposal.status === 'canceled' && proposal.rejectedAt) return proposalDetail(tx, userId, proposal);
    const [updated] = await tx
      .update(explorationProposals)
      .set({ status: 'canceled', rejectedAt: now, nextVerifyAt: null })
      .where(eq(explorationProposals.id, proposal.id))
      .returning();
    if (!updated) throw AppError.of(404, 'NOT_FOUND');
    return proposalDetail(tx, userId, updated);
  });
}

export async function runDueExplorationVerifications(now = new Date()): Promise<number> {
  const db = getDb();
  const due = await db
    .select({
      id: explorationProposals.id,
      userId: explorationProposals.userId,
    })
    .from(explorationProposals)
    .where(lte(explorationProposals.nextVerifyAt, now));
  let n = 0;
  for (const row of due) {
    await db.transaction(async (tx) => {
      const proposal = await loadOwnedProposal(tx, row.userId, row.id, true);
      if (proposal.status === 'canceled' || proposal.status === 'completed') return;
      const window = await loadOwnedWindow(tx, row.userId, proposal.windowId, true);
      const stage = inferStage(proposal.decisionDeadline, proposal.departureAt, now);
      await verifyProposalRow(tx, row.userId, proposal, window, stage, now);
    });
    n += 1;
  }
  return n;
}


