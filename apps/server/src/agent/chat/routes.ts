import type { ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  chatUndoBodySchema,
  chatUndoHintSchema,
  postChatMessageSchema,
  type ChatInvalidateTag,
} from '@vital/dto';
import { getUserEntity } from '../../auth/auth.service.js';
import { config } from '../../config.js';
import { AppError } from '../../errors.js';
import { requireAuth } from '../../plugins/auth.js';
import { limitLlm } from '../../plugins/rate-limit.js';
import { publishInvalidation } from '../../sync/sync.hub.js';
import { runChatTurn } from './loop.js';
import { releaseChat, tryAcquireChat } from './lock.js';
import {
  beginUserTurn,
  cancelPreview,
  getActiveConversation,
  getOwnedChatMessage,
  insertChatMessage,
  isBareUndo,
  latestUndoHints,
  listChatMessages,
  resetConversation,
  takePreview,
} from './store.js';
import { applyOrganize, organizeInputSchema } from './tools/organize.js';
import { applyUndo } from './undo.js';

const previewParams = z.object({ id: z.string().uuid() });

export function writeSse(raw: ServerResponse, event: string, data: unknown): void {
  try {
    raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // The socket can close while a token is still being written.
  }
}

function publish(userId: string, tags: ChatInvalidateTag[]): void {
  if (tags.length > 0) publishInvalidation(userId);
}

export function registerChatRoutes(app: FastifyInstance): void {
  app.get('/api/v1/agent/chat', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    if (!config.AGENT_CHAT_ENABLED) return { enabled: false, conversation: null, messages: [] };
    const conversation = await getActiveConversation(user.id);
    const messages = conversation ? await listChatMessages(user.id, conversation.id) : [];
    return { enabled: true, conversation, messages };
  });

  app.post('/api/v1/agent/chat/reset', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    if (!config.AGENT_CHAT_ENABLED) throw AppError.of(404, 'NOT_FOUND');
    const conversation = await resetConversation(user.id);
    return { enabled: true, conversation, messages: [] };
  });

  app.post('/api/v1/agent/chat/messages', { preHandler: [requireAuth, limitLlm] }, async (req, reply) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    if (!config.AGENT_CHAT_ENABLED) throw AppError.of(404, 'NOT_FOUND');
    const body = postChatMessageSchema.parse(req.body);
    if (!tryAcquireChat(user.id)) throw AppError.of(409, 'CHAT_BUSY');
    let headersSent = false;
    try {
      const turn = await beginUserTurn(user.id, body.text);
      if (isBareUndo(body.text)) {
        const hints = await latestUndoHints(user.id, turn.conversationId, turn.messageId);
        if (hints.length !== 1) {
          const messageId = await insertChatMessage({
            userId: user.id,
            conversationId: turn.conversationId,
            role: 'assistant',
            text: '请用卡片上的撤销',
          });
          return { messageId, text: '请用卡片上的撤销' };
        }
        const hint = hints[0];
        if (!hint) throw AppError.of(409, 'CHAT_PREVIEW_CLOSED');
        const tags = await applyUndo(user.id, hint.hint);
        publish(user.id, tags);
        const messageId = await insertChatMessage({
          userId: user.id,
          conversationId: turn.conversationId,
          role: 'assistant',
          text: '已撤销',
        });
        return { messageId, text: '已撤销', undone: true, invalidate: tags };
      }

      reply.hijack();
      headersSent = true;
      const raw = reply.raw;
      raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const ac = new AbortController();
      let finished = false;
      const onClose = () => {
        if (!finished) ac.abort();
      };
      raw.on('close', onClose);
      const result = await runChatTurn({
        userId: user.id,
        conversationId: turn.conversationId,
        userMessageId: turn.messageId,
        text: body.text,
        timezone: turn.timezone,
        page: body.context,
        signal: ac.signal,
        sink: {
          token: (text) => {
            writeSse(raw, 'token', { text });
          },
          tool: (card) => {
            writeSse(raw, 'tool', card);
          },
          done: (messageId) => {
            writeSse(raw, 'done', { messageId });
          },
          error: (code, message) => {
            writeSse(raw, 'error', { code, message });
          },
        },
      });
      finished = true;
      raw.off('close', onClose);
      publish(user.id, result.domainMutated ? ['tasks', 'today', 'habits'] : []);
      raw.end();
    } catch (err) {
      if (!headersSent) throw err;
      const code = err instanceof AppError ? err.code : 'EXECUTION_FAILED';
      const message = err instanceof AppError ? err.message : '这一步没有做成。';
      try {
        writeSse(reply.raw, 'error', { code, message });
        reply.raw.end();
      } catch {
        // The client already went away.
      }
    } finally {
      releaseChat(user.id);
    }
  });

  app.post('/api/v1/agent/chat/previews/:id/apply', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    if (!config.AGENT_CHAT_ENABLED) throw AppError.of(404, 'NOT_FOUND');
    const { id } = previewParams.parse(req.params);
    const row = await takePreview(user.id, id);
    if (!row || row.toolName !== 'tasks.organize') throw AppError.of(409, 'CHAT_PREVIEW_CLOSED');
    const parsed = organizeInputSchema.safeParse(row.args);
    if (!parsed.success) throw AppError.of(409, 'CHAT_PREVIEW_CLOSED');
    const entity = await getUserEntity(user.id);
    const applied = await applyOrganize(user.id, entity.timezone, parsed.data.ops);
    {
      for (const item of applied.undos) {
        await insertChatMessage({
          userId: user.id,
          conversationId: row.conversationId,
          role: 'tool',
          text: item.summary,
          toolName: 'tasks.organize',
          toolPayload: { status: 'ok', summary: item.summary, undo: item.undo, invalidate: applied.invalidate },
        });
      }
      await insertChatMessage({
        userId: user.id,
        conversationId: row.conversationId,
        role: 'assistant',
        text: applied.summary,
      });
    }
    publish(user.id, applied.invalidate);
    return { summary: applied.summary, invalidate: applied.invalidate, errors: applied.errors };
  });

  app.post('/api/v1/agent/chat/previews/:id/cancel', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    if (!config.AGENT_CHAT_ENABLED) throw AppError.of(404, 'NOT_FOUND');
    const { id } = previewParams.parse(req.params);
    await cancelPreview(user.id, id);
    return { ok: true };
  });

  app.post('/api/v1/agent/chat/undo', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    if (!config.AGENT_CHAT_ENABLED) throw AppError.of(404, 'NOT_FOUND');
    const { hintId } = chatUndoBodySchema.parse(req.body);
    const row = await getOwnedChatMessage(user.id, hintId);
    const undo = chatUndoHintSchema.safeParse(
      row?.toolPayload && typeof row.toolPayload === 'object' ? (row.toolPayload as { undo?: unknown }).undo : undefined,
    );
    if (!row || !undo.success) throw AppError.of(404, 'NOT_FOUND');
    const tags = await applyUndo(user.id, undo.data);
    await insertChatMessage({
      userId: user.id,
      conversationId: row.conversationId,
      role: 'assistant',
      text: '已撤销',
    });
    publish(user.id, tags);
    return { ok: true, invalidate: tags };
  });
}
