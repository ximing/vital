import { observer, useService } from '@rabjs/react';
import { MessageSquare } from 'lucide-react';
import { useEffect, useRef, useState, type FC, type PointerEvent as ReactPointerEvent } from 'react';
import { t } from '@/copy';
import { Icon } from '@/ui/icon';
import { AgentChatPanel } from './AgentChatPanel';
import { AgentChatService } from './agent-chat.service';
import {
  AGENT_CHAT_DOCK_MIN_PX,
  AGENT_CHAT_WIDTH_DEFAULT,
  AGENT_CHAT_WIDTH_MAX,
  AGENT_CHAT_WIDTH_MIN,
  agentChatWidthFromDrag,
  agentChatWidthFromKey,
  clampAgentChatWidth,
  loadAgentChatWidth,
  saveAgentChatWidth,
} from './chrome';

export const AgentChatRail: FC = observer(function AgentChatRail() {
  const chat = useService(AgentChatService);
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const [width, setWidth] = useState(() => loadAgentChatWidth());
  const drag = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!chat.enabled) return null;

  if (!chat.open) {
    return (
      <button
        type="button"
        data-region="agent-entry"
        className="fixed top-[22%] right-0 z-20 flex w-8 flex-col items-center gap-2 rounded-l-[10px] border border-r-0 border-border bg-surface py-3 text-muted shadow-[var(--shadow)] hover:bg-surface-muted hover:text-fg"
        aria-label={t.agentChat.expand}
        aria-expanded={false}
        onClick={() => chat.toggle()}
      >
        <Icon icon={MessageSquare} strokeWidth={1.8} />
        <span className="text-[12px] tracking-[0.14em] [writing-mode:vertical-rl]">{t.agentChat.title}</span>
      </button>
    );
  }

  const overlay = viewport < AGENT_CHAT_DOCK_MIN_PX;

  function applyWidth(next: number): void {
    const clamped = clampAgentChatWidth(next);
    setWidth(clamped);
    saveAgentChatWidth(clamped);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startW: width };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!drag.current) return;
    applyWidth(agentChatWidthFromDrag(drag.current.startW, drag.current.startX, event.clientX));
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <>
      {overlay ? (
        <button
          type="button"
          className="fixed inset-0 z-[45] border-0 bg-[var(--scrim)]"
          aria-label={t.agentChat.close}
          onClick={() => chat.close()}
        />
      ) : null}
      <div
        data-region="agent-chat-dock"
        className={
          overlay
            ? 'fixed top-0 right-0 bottom-0 z-[50] flex min-h-0 flex-col border-l border-border bg-surface shadow-[var(--shadow)]'
            : 'relative flex h-full min-h-0 shrink-0 flex-col border-l border-border bg-surface'
        }
        style={{ width: overlay ? Math.min(width, viewport) : width }}
      >
        {overlay ? null : (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t.agentChat.resize}
            aria-valuemin={AGENT_CHAT_WIDTH_MIN}
            aria-valuemax={AGENT_CHAT_WIDTH_MAX}
            aria-valuenow={width}
            tabIndex={0}
            className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-accent/40 focus-visible:bg-accent/40"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={() => applyWidth(AGENT_CHAT_WIDTH_DEFAULT)}
            onKeyDown={(event) => {
              const next = agentChatWidthFromKey(width, event.key);
              if (next === null) return;
              event.preventDefault();
              applyWidth(next);
            }}
          />
        )}
        <AgentChatPanel />
      </div>
    </>
  );
});
