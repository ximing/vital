import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type {
  AgentMemoryItem,
  CreateAgentMemoryInput,
  PatchAgentMemoryInput,
} from '@vital/dto';
import { getDb } from '../db/index.js';
import { agentMemory, agentMemoryHistory, users, AGENT_MEMORY_SCOPES, type AgentMemoryRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import { indexMemory, removeMemoryIndex, trackIndexJob } from '../retrieval/pipeline.js';

function toAgentMemoryDto(row: AgentMemoryRow): AgentMemoryItem {
  return {
    id: row.id,
    kind: row.kind as AgentMemoryItem['kind'],
    content: row.content,
    scope: row.scope,
    sourceCount: row.sourceCount,
    manual: row.manual,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Defense in depth for the scope CHECK constraint: drop unknown values, dedupe,
 * collapse 'all' (it subsumes every capability), and never persist an empty array.
 * The zod schemas already enforce legality at the route boundary; this guards
 * internal callers too.
 */
function sanitizeScope(scope: string[]): string[] {
  const legal = new Set<string>(AGENT_MEMORY_SCOPES);
  const filtered = [...new Set(scope.filter((value) => legal.has(value)))];
  if (filtered.length === 0 || filtered.includes('all')) return ['all'];
  return filtered;
}

/** List the caller's memory rows, newest first. Kind grouping is a client concern. */
export async function listAgentMemory(userId: string): Promise<AgentMemoryItem[]> {
  const rows = await getDb()
    .select()
    .from(agentMemory)
    .where(eq(agentMemory.userId, userId))
    .orderBy(desc(agentMemory.createdAt));
  return rows.map(toAgentMemoryDto);
}

/** Create a user-written row: manual=true (distill-protected), sourceCount=0. */
export async function createAgentMemory(
  userId: string,
  input: CreateAgentMemoryInput,
): Promise<AgentMemoryItem> {
  const row = await getDb().transaction(async tx => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('no key update');
    const [row] = await tx
    .insert(agentMemory)
    .values({
      id: randomUUID(),
      userId,
      kind: input.kind,
      content: input.content,
      scope: sanitizeScope(input.scope),
      sourceCount: 0,
      manual: true,
    })
    .returning();
  if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
    await tx.insert(agentMemoryHistory).values({ id: randomUUID(), userId, memoryId: row.id, revision: row.version, operation: 'manual.add', before: null, after: row, sourceFeedback: [], createdAt: row.createdAt });
    return row;
  });
  trackIndexJob(indexMemory(row), 'indexMemory');
  return toAgentMemoryDto(row);
}

export async function patchAgentMemory(
  userId: string,
  id: string,
  input: PatchAgentMemoryInput,
): Promise<AgentMemoryItem> {
  const updated = await getDb().transaction(async tx => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('no key update');
    const [row] = await tx.select().from(agentMemory).where(and(eq(agentMemory.id, id), eq(agentMemory.userId, userId))).for('no key update');
    if (!row) throw AppError.of(404, 'NOT_FOUND');
    const [updated] = await tx.update(agentMemory).set({
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.scope !== undefined ? { scope: sanitizeScope(input.scope) } : {}),
      manual: true, version: row.version + 1, updatedAt: new Date(),
    }).where(and(eq(agentMemory.id, id), eq(agentMemory.userId, userId))).returning();
    if (!updated) throw AppError.of(404, 'NOT_FOUND');
    await tx.insert(agentMemoryHistory).values({ id: randomUUID(), userId, memoryId: id, revision: updated.version, operation: 'manual.update', before: row, after: updated, sourceFeedback: [], createdAt: updated.updatedAt });
    return updated;
  });
  trackIndexJob(indexMemory(updated), 'indexMemory');
  return toAgentMemoryDto(updated);
}

export async function deleteAgentMemory(userId: string, id: string): Promise<void> {
  const deleted = await getDb().transaction(async tx => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('no key update');
    const [row] = await tx.delete(agentMemory).where(and(eq(agentMemory.id, id), eq(agentMemory.userId, userId))).returning();
    if (!row) throw AppError.of(404, 'NOT_FOUND');
    await tx.insert(agentMemoryHistory).values({ id: randomUUID(), userId, memoryId: id, revision: row.version + 1, operation: 'manual.drop', before: row, after: null, sourceFeedback: [], createdAt: new Date() });
    return row;
  });
  trackIndexJob(removeMemoryIndex(deleted.id), 'removeMemoryIndex');
}
