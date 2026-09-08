import { defineBackground } from 'wxt/utils/define-background';
import { badgeText } from '../src/capture-helpers.js';
import {
  handleActionClick,
  handleCommand,
  handleContextMenu,
  registerMenus,
  setBadge,
} from '../src/capture.js';
import { handleExternalAuth, handlePanelMessage } from '../src/client.js';
import {
  COMMIT_PORT_NAME,
  isCommitPortMessage,
  isOffscreenConvert,
  isOffscreenParse,
  isPanelRequest,
  type CommitPortEvent,
} from '../src/messages.js';

export default defineBackground({
  type: 'module',
  main() {
    void registerMenus();
    chrome.runtime.onInstalled.addListener(() => {
      void registerMenus();
    });

    chrome.action.onClicked.addListener((tab) => {
      void handleActionClick(tab);
    });

    chrome.contextMenus.onClicked.addListener((info, tab) => {
      void handleContextMenu(info, tab);
    });

    chrome.commands.onCommand.addListener((command) => {
      void handleCommand(command);
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id) return;
      if (isOffscreenParse(message) || isOffscreenConvert(message)) return;
      if (!isPanelRequest(message)) return;
      void handlePanelMessage(message).then(sendResponse, (err: unknown) => {
        const error = err instanceof Error ? err.message : '错误';
        sendResponse({ ok: false, error });
      });
      return true;
    });

    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== COMMIT_PORT_NAME) return;
      let alive = true;
      port.onDisconnect.addListener(() => {
        alive = false;
      });
      port.onMessage.addListener((message) => {
        if (!isCommitPortMessage(message)) return;
        void (async () => {
          const send = async (event: CommitPortEvent): Promise<void> => {
            if (alive) {
              try {
                port.postMessage(event);
                return;
              } catch {
                alive = false;
              }
            }
            // Popup closed mid-commit: degrade progress to the toolbar badge; the
            // commit itself keeps running so no data is lost.
            if (event.type === 'progress') await setBadge(badgeText('progress', event));
          };
          try {
            const { commitCapture } = await import('../src/capture.js');
            const { failed } = await commitCapture({
              capture: message.capture,
              title: message.title,
              note: message.note,
              mode: message.mode,
              listId: message.listId,
              onCreated: (outcome) =>
                send({ type: 'created', kind: outcome.kind, id: outcome.id }),
              onProgress: (done, total) => send({ type: 'progress', done, total }),
            });
            await send({ type: 'done', failed });
          } catch (err) {
            const { errorMessage } = await import('../src/client.js');
            await send({ type: 'error', message: errorMessage(err) });
          }
        })();
      });
    });

    chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
      void handleExternalAuth(message, sender.url).then(sendResponse);
      return true;
    });
  },
});
