import { Type, type Static } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { AGENT_MEMORY_SCOPES } from '../db/schema/agent.js';

/**
 * Agent capabilities are modeled as tool calls: the tool arguments ARE the
 * structured proposal. Each factory takes a capture callback — the harness
 * stops the loop once the proposal lands (see harness.ts).
 */

export const submitHeadlineSchema = Type.Object({
  /** One sentence: where this thread stands right now. */
  headline: Type.String({ minLength: 1, maxLength: 200 }),
  /** One concrete next move; empty string when nothing sensible. */
  suggestion: Type.String({ maxLength: 500 }),
});
export type SubmitHeadlineArgs = Static<typeof submitHeadlineSchema>;

export function submitHeadlineTool(capture: (args: SubmitHeadlineArgs) => void): AgentTool<typeof submitHeadlineSchema> {
  return {
    name: 'submit_headline',
    label: '提交线程状态',
    description: '提交该线程的一句话状态（headline）和一条下一步建议（suggestion）。',
    parameters: submitHeadlineSchema,
    execute: (_toolCallId, params) => {
      capture(params);
      return Promise.resolve({ content: [{ type: 'text', text: 'ok' }], details: null, terminate: true });
    },
  };
}

export const submitNotificationSchema = Type.Object({ message: Type.String({ minLength: 1, maxLength: 200 }) });
export type SubmitNotificationArgs = Static<typeof submitNotificationSchema>;
export function submitNotificationTool(capture: (args: SubmitNotificationArgs) => void): AgentTool<typeof submitNotificationSchema> {
  return { name: 'submit_notification', label: '提交主动提醒', description: '提交一句简短、自然、可行动的提醒文案。', parameters: submitNotificationSchema, execute: (_id, params) => { capture(params); return Promise.resolve({ content: [{ type: 'text', text: 'ok' }], details: null, terminate: true }); } };
}

export const proposeThreadsSchema = Type.Object({
  threads: Type.Array(
    Type.Object({
      /** Short thread name (≤ 20 chars ideal). */
      name: Type.String({ minLength: 1, maxLength: 60 }),
      /** Task ids from the provided list only. */
      taskIds: Type.Array(Type.String(), { minItems: 1 }),
      /** One-sentence headline for the new thread. */
      headline: Type.String({ maxLength: 200 }),
    }),
    { minItems: 1, maxItems: 5 },
  ),
});
export type ProposeThreadsArgs = Static<typeof proposeThreadsSchema>;

export function proposeThreadsTool(capture: (args: ProposeThreadsArgs) => void): AgentTool<typeof proposeThreadsSchema> {
  return {
    name: 'propose_threads',
    label: '提议线程聚类',
    description: '把未挂载的任务聚成 1-5 个线程，每个线程给出名字、包含的任务 id 和一句话状态。',
    parameters: proposeThreadsSchema,
    execute: (_toolCallId, params) => {
      capture(params);
      return Promise.resolve({ content: [{ type: 'text', text: 'ok' }], details: null, terminate: true });
    },
  };
}

export const proposeSubtasksSchema = Type.Object({
  subtasks: Type.Array(
    Type.Object({
      title: Type.String({ minLength: 1, maxLength: 200 }),
      estimateMinutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 24 * 60 })),
    }),
    { minItems: 1, maxItems: 10 },
  ),
});
export type ProposeSubtasksArgs = Static<typeof proposeSubtasksSchema>;

export function proposeSubtasksTool(capture: (args: ProposeSubtasksArgs) => void): AgentTool<typeof proposeSubtasksSchema> {
  return {
    name: 'propose_subtasks',
    label: '提议任务拆解',
    description: '把一个反复推迟的任务拆成 2-10 个可执行的子任务。',
    parameters: proposeSubtasksSchema,
    execute: (_toolCallId, params) => {
      capture(params);
      return Promise.resolve({ content: [{ type: 'text', text: 'ok' }], details: null, terminate: true });
    },
  };
}

export const submitDraftSchema = Type.Object({
  /** Execution-plan draft in Chinese, markdown bullet points. */
  draft: Type.String({ minLength: 1, maxLength: 2000 }),
  /** Optional split of the same plan into concrete subtasks. */
  subtasks: Type.Optional(
    Type.Array(
      Type.Object({
        title: Type.String({ minLength: 1, maxLength: 200 }),
        estimateMinutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 24 * 60 })),
      }),
      { minItems: 1, maxItems: 8 },
    ),
  ),
});
export type SubmitDraftArgs = Static<typeof submitDraftSchema>;

export function submitDraftTool(capture: (args: SubmitDraftArgs) => void): AgentTool<typeof submitDraftSchema> {
  return {
    name: 'submit_draft',
    label: '提交执行方案',
    description:
      '提交该任务的一份可执行方案草案（步骤顺序、所需材料和注意点），并在可拆时附带 2-8 个子任务。',
    parameters: submitDraftSchema,
    execute: (_toolCallId, params) => {
      capture(params);
      return Promise.resolve({ content: [{ type: 'text', text: 'ok' }], details: null, terminate: true });
    },
  };
}

export const submitReportSchema = Type.Object({
  /** Daily-report notes in Chinese markdown, without the heading. */
  notes: Type.String({ minLength: 1, maxLength: 4000 }),
});
export type SubmitReportArgs = Static<typeof submitReportSchema>;

export function submitReportTool(capture: (args: SubmitReportArgs) => void): AgentTool<typeof submitReportSchema> {
  return {
    name: 'submit_report',
    label: '提交日报记录',
    description: '提交日报「记录」一节的正文：客观、具体，markdown 短文，不要标题或实体引用。',
    parameters: submitReportSchema,
    execute: (_toolCallId, params) => {
      capture(params);
      return Promise.resolve({ content: [{ type: 'text', text: 'ok' }], details: null, terminate: true });
    },
  };
}

const memoryScopeSchema = Type.Union(
  AGENT_MEMORY_SCOPES.map((s) => Type.Literal(s)),
);
const memoryKindSchema = Type.Union([
  Type.Literal('preference'),
  Type.Literal('pattern'),
  Type.Literal('correction'),
]);

/**
 * Memory governance: the distill pass submits an operation stream over the
 * existing memories (merge/rewrite, evict, add, keep) instead of a bare
 * append list. Ids must come from the provided existing-memory list.
 */
export const submitMemoriesSchema = Type.Object({
  /** Ids of existing memories to keep as-is (prompt-side constraint only). */
  keep: Type.Optional(Type.Array(Type.String(), { maxItems: 30 })),
  /** Merge/rewrite an existing memory by id. */
  update: Type.Optional(
    Type.Array(
      Type.Object({
        id: Type.String(),
        content: Type.String({ minLength: 1, maxLength: 300 }),
        scope: Type.Optional(Type.Array(memoryScopeSchema, { maxItems: 6 })),
      }),
      { maxItems: 30 },
    ),
  ),
  /** New memories distilled from recent feedback. */
  add: Type.Optional(
    Type.Array(
      Type.Object({
        kind: memoryKindSchema,
        content: Type.String({ minLength: 1, maxLength: 300 }),
        scope: Type.Optional(Type.Array(memoryScopeSchema, { maxItems: 6 })),
      }),
      { maxItems: 5 },
    ),
  ),
  /** Ids of existing memories to evict (outdated or contradicted). */
  drop: Type.Optional(Type.Array(Type.String(), { maxItems: 30 })),
});
export type SubmitMemoriesArgs = Static<typeof submitMemoriesSchema>;

export function submitMemoriesTool(capture: (args: SubmitMemoriesArgs) => void): AgentTool<typeof submitMemoriesSchema> {
  return {
    name: 'submit_memories',
    label: '整理记忆',
    description:
      '整理现有长期记忆：update 合并或改写语义重复/表述不佳的条目，drop 淘汰过时或与近期反馈矛盾的条目，add 新增（≤5 条，preference/pattern/correction），keep 之外未被 update/drop 的条目原样保留。标注「用户手写」的条目不得 update/drop。',
    parameters: submitMemoriesSchema,
    execute: (_toolCallId, params) => {
      capture(params);
      return Promise.resolve({ content: [{ type: 'text', text: 'ok' }], details: null, terminate: true });
    },
  };
}
