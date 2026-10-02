import { observer, useService } from '@rabjs/react';
import { DEFAULT_LLM_SETTINGS, type ChatMessage, type ChatToolCard, type ChatUndoHint } from '@vital/dto';
import { ChevronDown, PanelRightClose } from 'lucide-react';
import { useEffect, useRef, useState, type FC } from 'react';
import { useLocation } from 'react-router';
import { client } from '@/api/client';
import { t } from '@/copy';
import { TodosUiService } from '@/features/todos/todos-ui.service';
import { humanError } from '@/lib/errors';
import { AuthService } from '@/services/auth.service';
import { FIELD_POPOVER_CLASS } from '@/ui/field';
import { Icon } from '@/ui/icon';
import { usePopover } from '@/ui/use-popover';
import { AgentChatService } from './agent-chat.service';
import { chatPageContext } from './context';
import { ChatMarkdown } from './markdown';
import { chatModelChoices, routingWithChatModel, selectedChatModel } from './models';

function payloadCard(message: ChatMessage): ChatToolCard | null {
  const payload = message.toolPayload;
  if (!payload || typeof payload !== 'object' || !('status' in payload)) return null;
  const status = (payload as { status?: unknown }).status;
  if (status !== 'ok' && status !== 'preview' && status !== 'needs_input' && status !== 'error') return null;
  const body = payload as {
    status: ChatToolCard['status'];
    summary?: string;
    question?: string;
    previewId?: string;
    undo?: ChatUndoHint;
    invalidate?: ChatToolCard['invalidate'];
  };
  return {
    tool: message.toolName ?? '',
    status: body.status,
    summary: body.status === 'needs_input' ? (body.question ?? body.summary ?? '') : (body.summary ?? ''),
    ...(body.previewId ? { previewId: body.previewId } : {}),
    ...(body.undo ? { undo: { hintId: message.id } } : {}),
    ...(body.question ? { question: body.question } : {}),
    ...(body.invalidate ? { invalidate: body.invalidate } : {}),
  };
}

function ToolCard({ card }: { card: ChatToolCard }) {
  const chat = useService(AgentChatService);
  return (
    <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-[length:var(--text-meta)]">
      <p className="whitespace-pre-wrap text-fg">{card.summary}</p>
      {card.status === 'preview' && card.previewId ? (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className="rounded-md bg-accent px-2.5 py-1 text-canvas"
            onClick={() => void chat.applyPreview(card.previewId ?? '')}
          >
            {t.agentChat.confirm}
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-2.5 py-1"
            onClick={() => void chat.cancelPreview(card.previewId ?? '')}
          >
            {t.agentChat.cancel}
          </button>
        </div>
      ) : null}
      {card.undo ? (
        <button
          type="button"
          className="mt-2 text-accent"
          onClick={() => void chat.undo(card.undo?.hintId ?? '')}
        >
          {t.agentChat.undo}
        </button>
      ) : null}
    </div>
  );
}

const ChatModelPicker: FC = observer(function ChatModelPicker() {
  const auth = useService(AuthService);
  const root = useRef<HTMLDivElement>(null);
  const popover = usePopover(root);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const llm = auth.user?.llm ?? DEFAULT_LLM_SETTINGS;
  const choices = chatModelChoices(llm);
  const selected = selectedChatModel(llm);

  async function choose(value: string): Promise<void> {
    const user = auth.user;
    if (!user || value === selected?.value || saving) return;
    const routing = routingWithChatModel(llm, value);
    if (!routing) return;
    setSaving(true);
    setSaveError(null);
    try {
      const next = await client.putLlmRouting({ routing });
      auth.setUser({ ...user, llm: next });
      popover.close();
    } catch (err) {
      setSaveError(humanError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        aria-label={t.agentChat.model}
        aria-haspopup="listbox"
        aria-expanded={popover.open}
        disabled={choices.length === 0 || saving}
        title={saveError ?? selected?.label ?? t.agentChat.noModel}
        className="inline-flex h-7 max-w-[11rem] items-center gap-1 rounded-md px-1.5 text-[length:var(--text-meta)] text-muted hover:bg-surface-muted hover:text-fg disabled:opacity-50"
        onClick={() => popover.toggle()}
      >
        <span className="truncate">{selected?.model ?? t.agentChat.noModel}</span>
        <Icon icon={ChevronDown} size={14} className="shrink-0" />
      </button>
      {popover.open ? (
        <div
          role="listbox"
          aria-label={t.agentChat.model}
          className={`absolute bottom-full left-0 z-[var(--z-dropdown)] mb-1 max-h-64 w-64 overflow-y-auto ${FIELD_POPOVER_CLASS} p-1`}
        >
          {saveError ? <p className="px-2 py-1 text-[length:var(--text-caption)] text-muted">{saveError}</p> : null}
          {choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="option"
              aria-selected={choice.value === selected?.value}
              className={`flex w-full items-center rounded-md px-2 py-1.5 text-left text-[length:var(--text-meta)] ${
                choice.value === selected?.value ? 'bg-accent-subtle text-fg' : 'text-fg hover:bg-surface-muted'
              }`}
              onClick={() => void choose(choice.value)}
            >
              <span className="truncate">{choice.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
});

export const AgentChatPanel: FC = observer(function AgentChatPanel() {
  const chat = useService(AgentChatService);
  const todos = useService(TodosUiService);
  const location = useLocation();
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    field.current?.focus();
  }, [chat.open]);

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chat.messages, chat.streamingText, chat.liveCards, chat.sending]);

  function send() {
    const text = draft.trim();
    if (!text || chat.sending) return;
    setDraft('');
    void chat.send(text, chatPageContext(location.pathname, location.search, todos.selectedId));
  }

  return (
    <aside
      data-region="agent-chat"
      aria-label={t.agentChat.title}
      className="flex h-full min-h-0 w-full min-w-0 flex-col bg-surface"
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <h2 className="min-w-0 flex-1 truncate font-display text-[length:var(--text-body)] font-semibold">{t.agentChat.title}</h2>
        <button type="button" className="text-[length:var(--text-meta)] text-muted hover:text-fg" onClick={() => void chat.reset()}>
          {t.agentChat.reset}
        </button>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-fg"
          aria-label={t.agentChat.close}
          onClick={() => chat.close()}
        >
          <Icon icon={PanelRightClose} strokeWidth={1.8} />
        </button>
      </header>
      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
        {chat.messages.length === 0 && !chat.sending ? (
          <p className="text-[length:var(--text-meta)] text-muted">{t.agentChat.empty}</p>
        ) : null}
        {chat.messages.map((message) => {
          if (message.role === 'tool') {
            const card = payloadCard(message);
            return card ? <ToolCard key={message.id} card={card} /> : null;
          }
          if (message.role === 'user') {
            return (
              <p key={message.id} className="ml-8 whitespace-pre-wrap rounded-md bg-accent-subtle px-3 py-2 text-[length:var(--text-body)]">
                {message.text}
              </p>
            );
          }
          return (
            <div key={message.id} className="mr-6 text-[length:var(--text-body)]">
              <ChatMarkdown text={message.text} />
            </div>
          );
        })}
        {chat.liveCards.map((card, index) => (
          <ToolCard key={`live-${String(index)}`} card={card} />
        ))}
        {chat.sending ? (
          <div className="mr-6 text-[length:var(--text-body)]" data-region="agent-stream">
            {chat.streamingText ? <ChatMarkdown text={chat.streamingText} /> : <p className="text-muted">{t.agentChat.thinking}</p>}
          </div>
        ) : null}
        {chat.error ? (
          <p role="alert" className="text-[length:var(--text-meta)] text-muted">
            {chat.error}
          </p>
        ) : null}
      </div>
      <form
        className="shrink-0 border-t border-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <textarea
          ref={field}
          value={draft}
          rows={3}
          placeholder={t.agentChat.placeholder}
          aria-label={t.agentChat.placeholder}
          className="w-full resize-none rounded-md border border-border bg-canvas px-3 py-2 text-[length:var(--text-body)] outline-none focus:border-accent"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div className="mt-2 flex items-center gap-2">
          <ChatModelPicker />
          <button type="submit" className="ml-auto rounded-md bg-accent px-3 py-1.5 text-[length:var(--text-meta)] text-canvas disabled:opacity-50" disabled={chat.sending || draft.trim() === ''}>
            {t.agentChat.send}
          </button>
        </div>
      </form>
    </aside>
  );
});
