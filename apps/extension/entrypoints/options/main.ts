import type { InboxItem, List, UserProfile } from '@vital/dto';
import { inboxReaderUrl } from '../../src/capture-helpers.js';
import { WEB_URL } from '../../src/config.js';
import type { CaptureDraft, PanelRequest, PanelResponse } from '../../src/messages.js';

const loginView = document.getElementById('login-view');
const homeView = document.getElementById('home-view');
const editView = document.getElementById('edit-view');
const loginError = document.getElementById('login-error');
const editError = document.getElementById('edit-error');
const empty = document.getElementById('empty');
const itemsEl = document.getElementById('items');
const titleInput = document.getElementById('edit-title');
const noteInput = document.getElementById('edit-note');
const listSelect = document.getElementById('edit-list');
const listWrap = document.getElementById('edit-list-wrap');

function show(el: HTMLElement | null, visible: boolean): void {
  if (el === null) return;
  el.hidden = !visible;
}

async function rpc(req: PanelRequest): Promise<PanelResponse> {
  const res: unknown = await chrome.runtime.sendMessage(req);
  if (typeof res === 'object' && res !== null && 'ok' in res) {
    return res as PanelResponse;
  }
  return { ok: false, error: '扩展未响应' };
}

function showError(el: HTMLElement | null, message: string | null): void {
  if (el === null) return;
  if (message === null || message === '') {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.textContent = message;
  el.hidden = false;
}

function setView(view: 'login' | 'home' | 'edit'): void {
  show(loginView, view === 'login');
  show(homeView, view === 'home');
  show(editView, view === 'edit');
}

function renderItems(items: InboxItem[]): void {
  if (itemsEl === null || empty === null) return;
  itemsEl.replaceChildren();
  show(empty, items.length === 0);
  for (const item of items) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'item';
    a.href = inboxReaderUrl(WEB_URL, item.id);
    a.target = '_blank';
    a.rel = 'noreferrer';
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = item.title;
    a.append(title);
    li.append(a);
    if (item.originalUrl) {
      const meta = document.createElement('div');
      meta.className = 'meta';
      const original = document.createElement('a');
      original.href = item.originalUrl;
      original.target = '_blank';
      original.rel = 'noreferrer';
      original.textContent = '原文';
      meta.append(original);
      li.append(meta);
    }
    itemsEl.append(li);
  }
}

async function loadRecent(): Promise<void> {
  const res = await rpc({ type: 'recent' });
  if (res.ok && 'items' in res) {
    renderItems(res.items);
    return;
  }
  renderItems([]);
}

function selectedMode(): 'inbox' | 'task' {
  const checked = document.querySelector('input[name="edit-mode"]:checked');
  if (checked instanceof HTMLInputElement && checked.value === 'task') return 'task';
  return 'inbox';
}

function fillDraft(draft: CaptureDraft, lists: List[]): void {
  if (titleInput instanceof HTMLInputElement) titleInput.value = draft.title;
  if (noteInput instanceof HTMLTextAreaElement) noteInput.value = draft.note;
  const taskMode = document.querySelector('input[name="edit-mode"][value="task"]');
  const inboxMode = document.querySelector('input[name="edit-mode"][value="inbox"]');
  if (taskMode instanceof HTMLInputElement) taskMode.checked = draft.mode === 'task';
  if (inboxMode instanceof HTMLInputElement) inboxMode.checked = draft.mode !== 'task';
  if (listSelect instanceof HTMLSelectElement) {
    listSelect.replaceChildren();
    for (const list of lists) {
      const opt = document.createElement('option');
      opt.value = list.id;
      opt.textContent = list.name;
      if (list.kind === 'inbox') opt.selected = true;
      listSelect.append(opt);
    }
  }
  show(listWrap, draft.mode === 'task');
}

async function showEdit(): Promise<boolean> {
  const draftRes = await rpc({ type: 'load-draft' });
  if (!draftRes.ok || !('draft' in draftRes) || draftRes.draft === null) return false;
  const listsRes = await rpc({ type: 'lists' });
  const lists = listsRes.ok && 'lists' in listsRes ? listsRes.lists : [];
  fillDraft(draftRes.draft, lists);
  setView('edit');
  return true;
}

function applySession(
  session: { loggedIn: false } | { loggedIn: true; profile: UserProfile },
): void {
  if (!session.loggedIn) {
    setView('login');
    return;
  }
  void showEdit().then((editing) => {
    if (editing) return;
    setView('home');
    void loadRecent();
  });
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (code !== null && code.length >= 20) {
    history.replaceState({}, '', location.pathname);
    const exchanged = await rpc({ type: 'exchange-code', code });
    if (exchanged.ok && 'session' in exchanged) {
      applySession(exchanged.session);
      return;
    }
    showError(loginError, exchanged.ok ? '登录失败' : exchanged.error);
  }
  const res = await rpc({ type: 'session' });
  if (res.ok && 'session' in res) {
    applySession(res.session);
    return;
  }
  setView('login');
}

document.getElementById('login-web')?.addEventListener('click', () => {
  showError(loginError, null);
  void rpc({ type: 'open-login' });
});

document.getElementById('logout')?.addEventListener('click', () => {
  void rpc({ type: 'logout' }).then(() => {
    setView('login');
  });
});

document.getElementById('open-web')?.addEventListener('click', () => {
  void rpc({ type: 'open-web' });
});

document.getElementById('edit-cancel')?.addEventListener('click', () => {
  void rpc({ type: 'clear-draft' }).then(() => {
    setView('home');
    void loadRecent();
  });
});

document.getElementById('edit-save')?.addEventListener('click', () => {
  showError(editError, null);
  const title = titleInput instanceof HTMLInputElement ? titleInput.value : '';
  const note = noteInput instanceof HTMLTextAreaElement ? noteInput.value : '';
  const mode = selectedMode();
  const listId =
    mode === 'task' && listSelect instanceof HTMLSelectElement && listSelect.value !== ''
      ? listSelect.value
      : undefined;
  void rpc({ type: 'commit-draft', title, note, mode, listId }).then((res) => {
    if (!res.ok) {
      showError(editError, res.error);
      return;
    }
    setView('home');
    void loadRecent();
  });
});

document.querySelectorAll('input[name="edit-mode"]').forEach((el) => {
  el.addEventListener('change', () => {
    show(listWrap, selectedMode() === 'task');
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'session-changed'
  ) {
    void boot();
  }
});

void boot();
