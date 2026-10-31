import { createHash, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { AgentJobTransaction } from '../agent/job-runtime.js';
import { getDb } from '../db/index.js';
import { agentMemoryHistory, continuityMemorySuppressions } from '../db/schema.js';

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function fingerprint(material: string): string {
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

export function memoryTopicFingerprint(kind: string, content: string): string {
  return fingerprint(`${kind}:${normalizeText(content)}`);
}

export function memoryEvidenceFingerprint(
  sourceIds: readonly string[],
  fallbackContent: string,
): string {
  const sources = [...new Set(sourceIds.filter((id) => id.length > 0))].sort();
  if (sources.length > 0) return fingerprint(`sources:${sources.join(',')}`);
  return fingerprint(`content:${normalizeText(fallbackContent)}`);
}

type SuppressDb = Pick<ReturnType<typeof getDb>, 'select'> | AgentJobTransaction;

export async function isMemorySuppressed(
  userId: string,
  topicFingerprint: string,
  evidenceFingerprint: string,
  db: SuppressDb = getDb(),
): Promise<boolean> {
  const [row] = await db
    .select({ id: continuityMemorySuppressions.id })
    .from(continuityMemorySuppressions)
    .where(
      and(
        eq(continuityMemorySuppressions.userId, userId),
        eq(continuityMemorySuppressions.topicFingerprint, topicFingerprint),
        eq(continuityMemorySuppressions.evidenceFingerprint, evidenceFingerprint),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function recordMemorySuppression(
  tx: AgentJobTransaction,
  input: {
    userId: string;
    memoryId: string;
    kind: string;
    content: string;
    now: Date;
  },
): Promise<void> {
  const history = await tx
    .select({ sourceFeedback: agentMemoryHistory.sourceFeedback })
    .from(agentMemoryHistory)
    .where(
      and(
        eq(agentMemoryHistory.userId, input.userId),
        eq(agentMemoryHistory.memoryId, input.memoryId),
      ),
    );
  const sourceIds = history.flatMap((row) => row.sourceFeedback.map((item) => item.actionId));
  await tx
    .insert(continuityMemorySuppressions)
    .values({
      id: randomUUID(),
      userId: input.userId,
      topicFingerprint: memoryTopicFingerprint(input.kind, input.content),
      evidenceFingerprint: memoryEvidenceFingerprint(sourceIds, input.content),
      createdAt: input.now,
    })
    .onConflictDoNothing();
}
