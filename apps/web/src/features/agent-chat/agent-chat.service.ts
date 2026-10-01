import { Service } from '@rabjs/react';
import type { ChatContext, ChatInvalidateTag, ChatMessage, ChatToolCard } from '@vital/dto';
import { client } from '@/api/client';
import { todayKeys } from '@/features/today/query-keys';
import { todoKeys } from '@/features/todos/query-keys';
import { humanError } from '@/lib/errors';
import { queryService } from '@/services/query.service';
import { loadAgentChatOpen, saveAgentChatOpen } from './chrome';

interface SseFrame {
  event: string;
  data: string;
}

function takeFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  const frames: SseFrame[] = [];
  for (const part of parts) {
    if (part.trim() === '') continue;
    let event = 'message';
    const data: string[] = [];
    for (const line of part.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trim());
    }
    if (data.length > 0) frames.push({ event, data: data.join('\n') });
  }
  return { frames, rest };
}

function invalidateTags(tags: ChatInvalidateTag[] | undefined): void {
  if (!tags || tags.length === 0) return;
  const query = queryService();
  if (tags.includes('tasks')) {
    void query.invalidate(todoKeys.all);
    void query.invalidate(todoKeys.counts);
    void query.invalidate(todoKeys.calendarRoot);
    void query.invalidate(todayKeys.all);
  }
  if (tags.includes('habits') || tags.includes('today') || tags.includes('outcomes')) {
    void query.invalidate(todayKeys.all);
  }
}

export class AgentChatService extends Service {
  open = loadAgentChatOpen();
  enabled = false;
  messages: ChatMessage[] = [];
  streamingText = '';
  liveCards: ChatToolCard[] = [];
  sending = false;
  error: string | null = null;
  private controller: AbortController | null = null;

  async load(): Promise<void> {
    try {
      const session = await client.getChatSession();
      this.enabled = session.enabled;
      this.messages = session.messages;
      if (!session.enabled) this.open = false;
    } catch {
      this.enabled = false;
    }
  }

  toggle(): void {
    if (!this.enabled) return;
    if (this.open) this.close();
    else this.rememberOpen(true);
  }

  close(): void {
    this.controller?.abort();
    this.controller = null;
    this.rememberOpen(false);
    this.sending = false;
    this.streamingText = '';
    this.liveCards = [];
  }

  private rememberOpen(open: boolean): void {
    this.open = open;
    saveAgentChatOpen(open);
  }

  async reset(): Promise<void> {
    this.controller?.abort();
    this.error = null;
    this.streamingText = '';
    this.liveCards = [];
    this.sending = false;
    try {
      const session = await client.resetChat();
      this.messages = session.messages;
    } catch (err) {
      this.error = humanError(err);
    }
  }

  async send(text: string, page: ChatContext): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.sending) return;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.sending = true;
    this.error = null;
    this.streamingText = '';
    this.liveCards = [];
    this.messages = [
      ...this.messages,
      {
        id: `local-${String(Date.now())}`,
        role: 'user',
        text: trimmed,
        toolName: null,
        toolPayload: null,
        createdAt: new Date().toISOString(),
      },
    ];
    try {
      const res = await client.postChatMessage({ text: trimmed, context: page }, controller.signal);
      const type = res.headers.get('content-type') ?? '';
      if (type.includes('application/json')) {
        const body = (await res.json()) as { invalidate?: ChatInvalidateTag[] };
        invalidateTags(body.invalidate);
        await this.load();
        return;
      }
      await this.readStream(res, controller.signal);
      await this.load();
    } catch (err) {
      if (controller.signal.aborted) return;
      this.error = humanError(err);
      await this.load().catch(() => undefined);
    } finally {
      if (this.controller === controller) {
        this.sending = false;
        this.streamingText = '';
        this.liveCards = [];
        this.controller = null;
      }
    }
  }

  async applyPreview(previewId: string): Promise<void> {
    this.error = null;
    try {
      const result = await client.applyChatPreview(previewId);
      invalidateTags(result.invalidate);
      await this.load();
    } catch (err) {
      this.error = humanError(err);
    }
  }

  async cancelPreview(previewId: string): Promise<void> {
    try {
      await client.cancelChatPreview(previewId);
      await this.load();
    } catch (err) {
      this.error = humanError(err);
    }
  }

  async undo(hintId: string): Promise<void> {
    this.error = null;
    try {
      const result = await client.undoChat(hintId);
      invalidateTags(result.invalidate);
      await this.load();
    } catch (err) {
      this.error = humanError(err);
    }
  }

  private async readStream(res: Response, signal: AbortSignal): Promise<void> {
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = '';
    while (!signal.aborted) {
      const step = await reader.read();
      if (step.done) break;
      buffer += decoder.decode(step.value, { stream: true });
      const parsed = takeFrames(buffer);
      buffer = parsed.rest;
      for (const frame of parsed.frames) this.applyFrame(frame);
    }
  }

  private applyFrame(frame: SseFrame): void {
    let payload: unknown;
    try {
      payload = JSON.parse(frame.data);
    } catch {
      return;
    }
    if (frame.event === 'token' && payload && typeof payload === 'object' && 'text' in payload) {
      const text = (payload as { text: unknown }).text;
      if (typeof text === 'string') this.streamingText += text;
      return;
    }
    if (frame.event === 'tool' && payload && typeof payload === 'object') {
      const card = payload as ChatToolCard;
      this.liveCards = [...this.liveCards, card];
      invalidateTags(card.invalidate);
      return;
    }
    if (frame.event === 'error' && payload && typeof payload === 'object' && 'message' in payload) {
      const message = (payload as { message: unknown }).message;
      if (typeof message === 'string') this.error = message;
    }
  }
}
