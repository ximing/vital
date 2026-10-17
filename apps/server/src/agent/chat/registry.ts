import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { TSchema } from '@earendil-works/pi-ai';
import { ZodError, type ZodType } from 'zod';
import { AppError } from '../../errors.js';
import { needsInput, toolError, type ToolCtx, type ToolMode, type ToolResult } from './types.js';

export interface ChatTool<T> {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  input: ZodType<T>;
  mode: ToolMode;
  handler: (ctx: ToolCtx, input: T) => Promise<ToolResult>;
  /** When a plan is open, fold this mutate into it instead of writing. */
  fold?: (ctx: ToolCtx, input: T) => Promise<ToolResult>;
}

const tools: ChatTool<unknown>[] = [];

export function register<T>(tool: ChatTool<T>): void {
  if (tools.some((item) => item.name === tool.name)) {
    throw new Error(`duplicate chat tool ${tool.name}`);
  }
  const stored: ChatTool<unknown> = {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    mode: tool.mode,
    input: tool.input,
    handler: (ctx, input) => tool.handler(ctx, input as T),
    ...(tool.fold ? { fold: (ctx, input) => tool.fold!(ctx, input as T) } : {}),
  };
  tools.push(stored);
}

export function listTools(): readonly ChatTool<unknown>[] {
  return tools;
}

export function findTool(name: string): ChatTool<unknown> | undefined {
  return tools.find((tool) => tool.name === name);
}

function planTool(name: string): boolean {
  return name === 'tasks.propose_plan' || name === 'tasks.propose_schedule';
}

function asText(result: ToolResult): string {
  if (result.status === 'needs_input') return JSON.stringify({ status: 'needs_input', question: result.question });
  if (result.status === 'error') return JSON.stringify({ status: 'error', code: result.code, summary: result.summary });
  if (result.status === 'preview') {
    return JSON.stringify({
      status: 'preview',
      summary: result.summary,
      previewId: result.previewId,
      ...(result.diffs ? { diffs: result.diffs } : {}),
    });
  }
  const data = result.data;
  let body: unknown = data;
  try {
    if (JSON.stringify(data).length > 8_000) body = { truncated: true };
  } catch {
    body = { truncated: true };
  }
  return JSON.stringify({ status: 'ok', summary: result.summary, data: body });
}

export function toAgentTool(tool: ChatTool<unknown>, ctx: ToolCtx): AgentTool {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    executionMode: 'sequential',
    execute: async (_toolCallId, params) => {
      let result: ToolResult;
      try {
        const planning = ctx.gate.plan != null;
        if (planning && tool.mode === 'mutate' && !planTool(tool.name)) {
          if (!tool.fold) {
            result = needsInput('方案里只改已有待办的标题、日期、优先级、状态和归属。');
          } else {
            const input = tool.input.parse(params ?? {});
            result = await tool.fold(ctx, input);
            if (result.status === 'preview') ctx.gate.plan = { previewId: result.previewId };
          }
        } else if (planTool(tool.name) && ctx.gate.mutated && !planning) {
          result = needsInput('这一轮已经直接改过一条。要出方案请重新开口。');
        } else if (tool.mode === 'mutate' && ctx.gate.mutated && !planTool(tool.name)) {
          result = needsInput('一次只能改一件。要改多条请用 tasks.organize。');
        } else {
          const input = tool.input.parse(params ?? {});
          result = await tool.handler(ctx, input);
          if (tool.mode === 'mutate' && result.status === 'ok') {
            ctx.gate.mutated = true;
            ctx.domainMutated.value = true;
          }
          if (planTool(tool.name) && result.status === 'preview') {
            ctx.gate.plan = { previewId: result.previewId };
            ctx.gate.mutated = true;
          }
        }
      } catch (err) {
        if (err instanceof ZodError) {
          result = needsInput('参数不完整，请用一句话说明要改什么。');
        } else if (err instanceof AppError) {
          result = toolError(err.code, err.message);
        } else {
          result = toolError('EXECUTION_FAILED', '这一步没有做成。');
        }
      }
      return {
        content: [{ type: 'text', text: asText(result) }],
        details: result,
      };
    },
  };
}
