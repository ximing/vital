import { defineBackground } from 'wxt/utils/define-background';
import { handleActionClick, handleContextMenu, registerMenus } from '../src/capture.js';
import { handlePanelMessage } from '../src/client.js';
import { isPanelRequest } from '../src/messages.js';
import { isOffscreenParse } from '../src/offscreen.js';

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

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id) return;
      if (isOffscreenParse(message)) return;
      if (!isPanelRequest(message)) return;
      void handlePanelMessage(message).then(sendResponse, (err: unknown) => {
        const error = err instanceof Error ? err.message : '错误';
        sendResponse({ ok: false, error });
      });
      return true;
    });
  },
});
