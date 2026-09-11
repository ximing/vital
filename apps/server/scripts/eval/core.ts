import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { AgentMetricsResponse } from '@vital/dto';
import { getDb } from '../../src/db/index.js';
import { users } from '../../src/db/schema.js';
import { agentAdoptionDaily } from '../../src/agent/metrics.service.js';
import { FIXTURE_TZ, FIXTURE_USER_ID, seedFixture } from './fixture.js';

/** Offline, repeatable evaluation of the agent feedback metrics (proposed/adopted/dismissed/undone/adoptionRate/costPerAdopted). */
export const EVAL_WINDOW_DAYS = 30;

const here = dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT_DIR = resolve(here, '__snapshots__');
export const BASELINE_PATH = resolve(SNAPSHOT_DIR, 'baseline.json');
export const LATEST_PATH = resolve(SNAPSHOT_DIR, 'latest.json');

export interface AgentEvalSnapshot {
  version: 1;
  windowDays: number;
  timezone: string;
  summary: {
    proposed: number;
    adopted: number;
    dismissed: number;
    undone: number;
    adoptionRate: number;
  };
  perCapability: AgentMetricsResponse['summary']['perCapability'];
  /** Daily rows keyed by days-ago (0 = today in the fixture timezone) so the snapshot stays valid across days. */
  daily: {
    dayOffset: number;
    proposed: number;
    adopted: number;
    dismissed: number;
    undone: number;
    adoptionRate: number;
  }[];
}

/**
 * Reseed the fixture user (cascade-clears their actions/usage/memory) and
 * compute the snapshot. `tamper` flips one accepted feedback to dismissed —
 * the mutation `--check` must always catch.
 */
export async function buildSnapshot(opts: { tamper?: boolean } = {}): Promise<AgentEvalSnapshot> {
  const db = getDb();
  await db.delete(users).where(eq(users.id, FIXTURE_USER_ID));
  await seedFixture(db, opts);
  const metrics = await agentAdoptionDaily(FIXTURE_USER_ID, EVAL_WINDOW_DAYS, FIXTURE_TZ);
  return normalize(metrics);
}

function normalize(metrics: AgentMetricsResponse): AgentEvalSnapshot {
  const today = DateTime.now().setZone(FIXTURE_TZ).startOf('day');
  const dayOffset = (date: string): number =>
    Math.round(
      today
        .diff(DateTime.fromISO(date, { zone: FIXTURE_TZ }).startOf('day'), 'days')
        .as('days'),
    );
  return {
    version: 1,
    windowDays: EVAL_WINDOW_DAYS,
    timezone: FIXTURE_TZ,
    summary: {
      proposed: metrics.summary.proposed,
      adopted: metrics.summary.adopted,
      dismissed: metrics.summary.dismissed,
      undone: metrics.summary.undone,
      adoptionRate: metrics.summary.adoptionRate,
    },
    perCapability: metrics.summary.perCapability,
    daily: metrics.daily.map((row) => ({
      dayOffset: dayOffset(row.date),
      proposed: row.proposed,
      adopted: row.adopted,
      dismissed: row.dismissed,
      undone: row.undone,
      adoptionRate: row.adoptionRate,
    })),
  };
}

/** Top-level key differences between two snapshots; empty means identical. */
export function diffSnapshots(baseline: unknown, fresh: unknown): string[] {
  const left = (baseline ?? {}) as Record<string, unknown>;
  const right = (fresh ?? {}) as Record<string, unknown>;
  const diffs: string[] = [];
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const a = JSON.stringify(left[key]);
    const b = JSON.stringify(right[key]);
    if (a !== b) diffs.push(`${key}: baseline ${a ?? 'undefined'} ≠ fresh ${b ?? 'undefined'}`);
  }
  return diffs;
}
