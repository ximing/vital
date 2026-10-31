import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  ContinuityAuthorization,
  ContinuityCadence,
  ContinuityInterventionContent,
  ContinuityJudgement,
  ContinuityLifecycle,
  ContinuityMinAction,
} from '@vital/dto';

/** Per-user continuity prefs. No foreign key; user_id is checked in the service. */
export const continuityUserSettings = pgTable(
  'continuity_user_settings',
  {
    userId: char('user_id', { length: 36 }).primaryKey(),
    explorationWeekend: boolean('exploration_weekend').notNull().default(false),
    explorationHoliday: boolean('exploration_holiday').notNull().default(false),
    /** Explicit public-holiday region. NULL means unknown — never treat holiday_calendar default CN as the user. */
    region: varchar('region', { length: 8 }),
    externalSearch: boolean('external_search').notNull().default(false),
    dailyPushLimit: integer('daily_push_limit').notNull().default(1),
    weeklyPushLimit: integer('weekly_push_limit').notNull().default(3),
    defaultCadence: jsonb('default_cadence').$type<ContinuityCadence | null>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    check('continuity_user_settings_daily_push_check', sql`${t.dailyPushLimit} BETWEEN 1 AND 5`),
    check('continuity_user_settings_weekly_push_check', sql`${t.weeklyPushLimit} BETWEEN 1 AND 14`),
  ],
);

export const continuityContracts = pgTable(
  'continuity_contracts',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    outcomeId: char('outcome_id', { length: 36 }).notNull(),
    lifecycle: varchar('lifecycle', { length: 16 }).notNull().default('draft').$type<ContinuityLifecycle>(),
    judgement: varchar('judgement', { length: 16 }).$type<ContinuityJudgement | null>(),
    currentRevision: integer('current_revision').notNull().default(0),
    authorizationVersion: integer('authorization_version').notNull().default(0),
    factsVersion: integer('facts_version').notNull().default(0),
    nextCheckAt: timestamp('next_check_at', { withTimezone: true, mode: 'date' }),
    pausedUntil: timestamp('paused_until', { withTimezone: true, mode: 'date' }),
    inAppOnlyUntil: timestamp('in_app_only_until', { withTimezone: true, mode: 'date' }),
    unansweredStreak: integer('unanswered_streak').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('continuity_contracts_user_outcome_uidx').on(t.userId, t.outcomeId),
    index('idx_continuity_contracts_user_lifecycle_check').on(t.userId, t.lifecycle, t.nextCheckAt),
    check(
      'continuity_contracts_lifecycle_check',
      sql`${t.lifecycle} IN ('draft', 'active', 'paused', 'ended')`,
    ),
    check(
      'continuity_contracts_judgement_check',
      sql`${t.judgement} IS NULL OR ${t.judgement} IN ('on_track', 'watching', 'needs_adjust', 'waiting')`,
    ),
  ],
);

export const continuityContractRevisions = pgTable(
  'continuity_contract_revisions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    contractId: char('contract_id', { length: 36 }).notNull(),
    revision: integer('revision').notNull(),
    meaning: text('meaning').notNull().default(''),
    stageGoal: text('stage_goal').notNull().default(''),
    completionCriteria: jsonb('completion_criteria').$type<string[]>().notNull().default([]),
    cadence: jsonb('cadence').$type<ContinuityCadence>().notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    weekStartsOn: smallint('week_starts_on').notNull(),
    minAction: jsonb('min_action').$type<ContinuityMinAction>().notNull(),
    evidenceBindings: jsonb('evidence_bindings').$type<unknown[]>().notNull().default([]),
    actionableWindows: jsonb('actionable_windows').$type<unknown[]>().notNull().default([]),
    authorization: jsonb('authorization').$type<ContinuityAuthorization>().notNull(),
    concernRefs: jsonb('concern_refs').$type<unknown[]>().notNull().default([]),
    idempotencyKey: varchar('idempotency_key', { length: 128 }),
    activatedAt: timestamp('activated_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('continuity_contract_revisions_contract_revision_uidx').on(t.contractId, t.revision),
    uniqueIndex('continuity_contract_revisions_idempotency_uidx')
      .on(t.userId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    check('continuity_contract_revisions_week_starts_on_check', sql`${t.weekStartsOn} IN (0, 1)`),
  ],
);

export const continuityOpportunities = pgTable(
  'continuity_opportunities',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    contractId: char('contract_id', { length: 36 }).notNull(),
    revision: integer('revision').notNull(),
    kind: varchar('kind', { length: 16 }).notNull(),
    windowKey: varchar('window_key', { length: 128 }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }).notNull(),
    checkAt: timestamp('check_at', { withTimezone: true, mode: 'date' }).notNull(),
    localStartDate: date('local_start_date', { mode: 'string' }).notNull(),
    localEndDate: date('local_end_date', { mode: 'string' }).notNull(),
    timezoneSnapshot: varchar('timezone_snapshot', { length: 64 }).notNull(),
    targetCount: integer('target_count').notNull().default(1),
    status: varchar('status', { length: 16 }).notNull(),
    exemptReason: text('exempt_reason'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('continuity_opportunities_window_uidx').on(t.contractId, t.revision, t.windowKey),
    index('idx_continuity_opportunities_user_check').on(t.userId, t.checkAt),
    index('idx_continuity_opportunities_contract_status').on(t.contractId, t.status),
    check('continuity_opportunities_kind_check', sql`${t.kind} IN ('timed', 'weekly_count')`),
    check(
      'continuity_opportunities_status_check',
      sql`${t.status} IN ('scheduled', 'open', 'met', 'missed', 'exempt', 'canceled')`,
    ),
  ],
);

export const continuityEvidence = pgTable(
  'continuity_evidence',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    sourceType: varchar('source_type', { length: 16 }).notNull(),
    sourceId: char('source_id', { length: 36 }),
    sourceRevision: integer('source_revision'),
    actor: varchar('actor', { length: 16 }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'date' }).notNull(),
    body: jsonb('body').$type<Record<string, unknown>>().notNull().default({}),
    supersedesId: char('supersedes_id', { length: 36 }),
    retractedAt: timestamp('retracted_at', { withTimezone: true, mode: 'date' }),
    idempotencyKey: varchar('idempotency_key', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('continuity_evidence_source_uidx')
      .on(t.userId, t.sourceType, t.sourceId, t.sourceRevision)
      .where(sql`${t.sourceId} IS NOT NULL AND ${t.retractedAt} IS NULL`),
    uniqueIndex('continuity_evidence_idempotency_uidx')
      .on(t.userId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    index('idx_continuity_evidence_user_occurred').on(t.userId, t.occurredAt),
    check(
      'continuity_evidence_source_type_check',
      sql`${t.sourceType} IN ('task_done', 'habit_checkin', 'self_report', 'user_confirm', 'agent_prep')`,
    ),
    check('continuity_evidence_actor_check', sql`${t.actor} IN ('user', 'agent', 'system')`),
  ],
);

export const continuityEvidenceLinks = pgTable(
  'continuity_evidence_links',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    evidenceId: char('evidence_id', { length: 36 }).notNull(),
    contractId: char('contract_id', { length: 36 }).notNull(),
    opportunityId: char('opportunity_id', { length: 36 }),
    meetsCriteria: boolean('meets_criteria').notNull().default(false),
    rationale: text('rationale'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [unique('continuity_evidence_links_pair_uidx').on(t.evidenceId, t.contractId)],
);

export const continuityInterventions = pgTable(
  'continuity_interventions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    contractId: char('contract_id', { length: 36 }).notNull(),
    revision: integer('revision').notNull(),
    kind: varchar('kind', { length: 32 }).notNull(),
    factFingerprint: varchar('fact_fingerprint', { length: 128 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    actionableUntil: timestamp('actionable_until', { withTimezone: true, mode: 'date' }),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true, mode: 'date' }),
    content: jsonb('content').$type<ContinuityInterventionContent>().notNull().default({} as ContinuityInterventionContent),
    draftRef: varchar('draft_ref', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('continuity_interventions_open_uidx')
      .on(t.contractId, t.kind, t.factFingerprint, t.revision)
      .where(sql`${t.status} IN ('open', 'snoozed')`),
    index('idx_continuity_interventions_user_status_expires').on(t.userId, t.status, t.expiresAt),
    check(
      'continuity_interventions_kind_check',
      sql`${t.kind} IN ('stall_adjust', 'work_risk', 'explore', 'experiment_review')`,
    ),
    check(
      'continuity_interventions_status_check',
      sql`${t.status} IN ('open', 'snoozed', 'accepted', 'dismissed', 'resolved', 'expired', 'withdrawn')`,
    ),
  ],
);

export const continuityExperiments = pgTable(
  'continuity_experiments',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    contractId: char('contract_id', { length: 36 }).notNull(),
    beforeRevision: integer('before_revision').notNull(),
    afterRevision: integer('after_revision').notNull(),
    hypothesis: text('hypothesis').notNull().default(''),
    baseline: jsonb('baseline').$type<Record<string, unknown>>().notNull().default({}),
    goal: jsonb('goal').$type<Record<string, unknown>>().notNull().default({}),
    windowStart: timestamp('window_start', { withTimezone: true, mode: 'date' }).notNull(),
    windowEnd: timestamp('window_end', { withTimezone: true, mode: 'date' }).notNull(),
    planId: char('plan_id', { length: 36 }),
    status: varchar('status', { length: 16 }).notNull(),
    review: jsonb('review').$type<Record<string, unknown>>(),
    reviewVersion: integer('review_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('continuity_experiments_active_uidx')
      .on(t.contractId)
      .where(sql`${t.status} IN ('draft', 'active', 'review_ready')`),
    check(
      'continuity_experiments_status_check',
      sql`${t.status} IN ('draft', 'active', 'review_ready', 'completed', 'interrupted', 'superseded')`,
    ),
  ],
);

export const continuityEvents = pgTable(
  'continuity_events',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    aggregateId: char('aggregate_id', { length: 36 }).notNull(),
    sequence: integer('sequence').notNull(),
    type: varchar('type', { length: 64 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
    retryCount: integer('retry_count').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('continuity_events_aggregate_sequence_uidx').on(t.aggregateId, t.sequence),
    index('idx_continuity_events_unprocessed')
      .on(t.createdAt)
      .where(sql`${t.processedAt} IS NULL`),
  ],
);

export const continuityExposures = pgTable(
  'continuity_exposures',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    candidateId: char('candidate_id', { length: 36 }).notNull(),
    surface: varchar('surface', { length: 32 }).notNull(),
    reservedAt: timestamp('reserved_at', { withTimezone: true, mode: 'date' }),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
    seenAt: timestamp('seen_at', { withTimezone: true, mode: 'date' }),
    handledAt: timestamp('handled_at', { withTimezone: true, mode: 'date' }),
    failedAt: timestamp('failed_at', { withTimezone: true, mode: 'date' }),
    budgetClass: varchar('budget_class', { length: 16 }).notNull(),
    periodKey: varchar('period_key', { length: 16 }).notNull(),
    outboxId: char('outbox_id', { length: 36 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_continuity_exposures_user_period_budget').on(t.userId, t.periodKey, t.budgetClass),
    index('idx_continuity_exposures_candidate_surface').on(t.candidateId, t.surface),
    check(
      'continuity_exposures_surface_check',
      sql`${t.surface} IN ('today', 'morning_brief', 'evening_digest', 'weekly', 'push')`,
    ),
    check('continuity_exposures_budget_class_check', sql`${t.budgetClass} IN ('ordinary', 'work_risk')`),
  ],
);

export const continuityMemorySuppressions = pgTable(
  'continuity_memory_suppressions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    topicFingerprint: varchar('topic_fingerprint', { length: 128 }).notNull(),
    evidenceFingerprint: varchar('evidence_fingerprint', { length: 128 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('continuity_memory_suppressions_uidx').on(
      t.userId,
      t.topicFingerprint,
      t.evidenceFingerprint,
    ),
  ],
);

export const continuityDependencies = pgTable(
  'continuity_dependencies',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    contractId: char('contract_id', { length: 36 }).notNull(),
    blockedType: varchar('blocked_type', { length: 16 }).notNull(),
    blockedId: char('blocked_id', { length: 36 }).notNull(),
    prerequisiteType: varchar('prerequisite_type', { length: 16 }).notNull(),
    prerequisiteId: char('prerequisite_id', { length: 36 }),
    externalLabel: text('external_label'),
    status: varchar('status', { length: 16 }).notNull().default('open'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    lastUserUpdateAt: timestamp('last_user_update_at', { withTimezone: true, mode: 'date' }),
    revision: integer('revision').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_continuity_dependencies_user_contract').on(t.userId, t.contractId),
    index('idx_continuity_dependencies_prereq').on(
      t.userId,
      t.prerequisiteType,
      t.prerequisiteId,
    ),
    check('continuity_dependencies_blocked_type_check', sql`${t.blockedType} IN ('task', 'outcome')`),
    check(
      'continuity_dependencies_prereq_type_check',
      sql`${t.prerequisiteType} IN ('task', 'outcome', 'external')`,
    ),
    check(
      'continuity_dependencies_status_check',
      sql`${t.status} IN ('open', 'resolved', 'canceled')`,
    ),
    check(
      'continuity_dependencies_prereq_id_check',
      sql`(${t.prerequisiteType} = 'external' AND ${t.prerequisiteId} IS NULL) OR (${t.prerequisiteType} <> 'external' AND ${t.prerequisiteId} IS NOT NULL)`,
    ),
  ],
);

export const continuityProtectedBlocks = pgTable(
  'continuity_protected_blocks',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    kind: varchar('kind', { length: 16 }).notNull(),
    label: varchar('label', { length: 120 }).notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    startAt: timestamp('start_at', { withTimezone: true, mode: 'date' }),
    endAt: timestamp('end_at', { withTimezone: true, mode: 'date' }),
    weekday: smallint('weekday'),
    startHm: varchar('start_hm', { length: 5 }),
    endHm: varchar('end_hm', { length: 5 }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_continuity_protected_blocks_user').on(t.userId),
    check('continuity_protected_blocks_kind_check', sql`${t.kind} IN ('once', 'weekly')`),
    check(
      'continuity_protected_blocks_shape_check',
      sql`(${t.kind} = 'once' AND ${t.startAt} IS NOT NULL AND ${t.endAt} IS NOT NULL) OR (${t.kind} = 'weekly' AND ${t.weekday} IS NOT NULL AND ${t.startHm} IS NOT NULL AND ${t.endHm} IS NOT NULL)`,
    ),
    check(
      'continuity_protected_blocks_weekday_check',
      sql`${t.weekday} IS NULL OR ${t.weekday} BETWEEN 0 AND 6`,
    ),
  ],
);

export type ContinuityUserSettingsRow = typeof continuityUserSettings.$inferSelect;
export type ContinuityContractRow = typeof continuityContracts.$inferSelect;
export type ContinuityContractRevisionRow = typeof continuityContractRevisions.$inferSelect;
export type ContinuityOpportunityRow = typeof continuityOpportunities.$inferSelect;
export type ContinuityEvidenceRow = typeof continuityEvidence.$inferSelect;
export type ContinuityEvidenceLinkRow = typeof continuityEvidenceLinks.$inferSelect;
export type ContinuityInterventionRow = typeof continuityInterventions.$inferSelect;
export type ContinuityExperimentRow = typeof continuityExperiments.$inferSelect;
export type ContinuityEventRow = typeof continuityEvents.$inferSelect;
export type ContinuityExposureRow = typeof continuityExposures.$inferSelect;
export type ContinuityMemorySuppressionRow = typeof continuityMemorySuppressions.$inferSelect;
export type ContinuityDependencyRow = typeof continuityDependencies.$inferSelect;
export type ContinuityProtectedBlockRow = typeof continuityProtectedBlocks.$inferSelect;
