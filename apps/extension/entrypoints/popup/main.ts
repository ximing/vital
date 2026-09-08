import type { InboxItem, List } from '@vital/dto';
import { inboxListUrl, inboxReaderUrl } from '../../src/capture-helpers.js';
import { WEB_URL } from '../../src/config.js';
import { copy } from '../../src/i18n.js';
import {
  COMMIT_PORT_NAME,
  type CapturePayload,
  type CommitPortEvent,
  type CommitPortMessage,
  type PanelRequest,
  type PanelResponse,
  type PopupMode,
} from '../../src/messages.js';
import {
  fileMetaLine,
  initialMode,
  metaLine,
  modeDisabled,
  progressLabel,
  savedLabel,
  titleForMode,
} from '../../src/popup-state.js';

type View = 'loading' | 'login' | 'login-done' | 'capture' | 'saved' | 'error' | 'recent';
const VIEWS: readonly View[] = [
  'loading',
  'login',
  'login-done',
  'capture',
  'saved',
  'error',
  'recent',
];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function show(el: HTMLElement, visible: boolean): void {
  el.hidden = !visible;
}

async function rpc(req: PanelRequest): Promise<PanelResponse> {
  const res: unknown = await chrome.runtime.sendMessage(req);
  if (typeof res === 'object' && res !== null && 'ok' in res) {
    return res as PanelResponse;
  }
  return { ok: false, error: copy.toastFailed };
}

let capture: CapturePayload | null = null;
let mode: PopupMode = 'article';
let lists: List[] | null = null;
let savedKind: 'created' | 'existing' | 'task' = 'created';
// One-shot: this popup was opened as the `?code=` login-fallback tab. The
// exchange-code RPC makes the background broadcast `session-changed`, whose
// handler would re-boot us — but a re-boot has no code and the active tab is
// this chrome-extension:// page, so capture-active-tab would fail and clobber
// the logged-in view. Ignore that echo; other session changes still re-boot.
let handshakeDone = false;

function setView(view: View): void {
  for (const v of VIEWS) show($(`view-${v}`), v === view);
  show($('footer'), view === 'capture');
}

function renderCapture(): void {
  if (capture === null) return;
  for (const m of ['article', 'selection', 'task', 'file'] as const) {
    const btn = $<HTMLButtonElement>(`mode-${m}`);
    // Direct-file pages have no selection or task content to offer.
    show(btn, !(mode === 'file' && (m === 'selection' || m === 'task')));
    btn.classList.toggle('active', m === mode);
    btn.disabled = m === 'file' ? capture.file === null : modeDisabled(m, capture.selection);
  }
  $<HTMLInputElement>('capture-title').value = titleForMode(capture, mode);
  $('capture-meta').textContent =
    mode === 'file' && capture.file !== null
      ? fileMetaLine(capture.file)
      : metaLine(capture, mode);
  show($('capture-list-wrap'), mode === 'task');
  if (mode === 'task' && lists === null) void loadLists();
}

async function loadLists(): Promise<void> {
  const res = await rpc({ type: 'lists' });
  if (!res.ok || !('lists' in res)) return;
  lists = res.lists;
  const select = $<HTMLSelectElement>('capture-list');
  select.replaceChildren();
  for (const list of lists) {
    const opt = document.createElement('option');
    opt.value = list.id;
    opt.textContent = list.name;
    if (list.kind === 'inbox') opt.selected = true;
    select.append(opt);
  }
}

function commit(): void {
  if (capture === null) return;
  const message: CommitPortMessage = {
    type: 'commit-capture',
    capture,
    title: $<HTMLInputElement>('capture-title').value,
    note: $<HTMLTextAreaElement>('capture-note').value,
    mode,
    listId:
      mode === 'task' && $<HTMLSelectElement>('capture-list').value !== ''
        ? $<HTMLSelectElement>('capture-list').value
        : undefined,
  };
  $<HTMLButtonElement>('save').disabled = true;
  const port = chrome.runtime.connect({ name: COMMIT_PORT_NAME });
  let settled = false;
  // The port died before done/error arrived (background crashed or was
  // suspended): surface the failure instead of leaving save disabled forever.
  port.onDisconnect.addListener(() => {
    if (settled) return;
    settled = true;
    $<HTMLButtonElement>('save').disabled = false;
    $('error-message').textContent = copy.toastFailed;
    setView('error');
  });
  port.onMessage.addListener((raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) return;
    const ev = raw as CommitPortEvent;
    if (ev.type === 'created') {
      savedKind = ev.kind;
      $('saved-title').textContent = savedLabel(ev.kind, 0);
      $<HTMLAnchorElement>('saved-open').href =
        ev.kind === 'task' ? inboxListUrl(WEB_URL) : inboxReaderUrl(WEB_URL, ev.id);
      show($('saved-progress'), false);
      setView('saved');
      return;
    }
    if (ev.type === 'progress') {
      $('saved-progress').textContent = progressLabel(ev.done, ev.total);
      show($('saved-progress'), true);
      return;
    }
    if (ev.type === 'done') {
      settled = true;
      $('saved-title').textContent = savedLabel(savedKind, ev.failed);
      show($('saved-progress'), false);
      return;
    }
    if (ev.type === 'error') {
      settled = true;
      $<HTMLButtonElement>('save').disabled = false;
      $('error-message').textContent = ev.message;
      setView('error');
    }
  });
  port.postMessage(message);
}

async function showRecent(): Promise<void> {
  setView('recent');
  const res = await rpc({ type: 'recent' });
  const items: InboxItem[] = res.ok && 'items' in res ? res.items : [];
  const ul = $('recent-items');
  ul.replaceChildren();
  show($('recent-empty'), items.length === 0);
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
    ul.append(li);
  }
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (code !== null && code.length >= 20) {
    // Opened as a tab by the web login fallback: finish the handshake, then stop.
    // Arm the guard before awaiting — the background broadcasts session-changed
    // before this RPC resolves, so the echo would beat a post-await assignment.
    handshakeDone = true;
    history.replaceState({}, '', location.pathname);
    const res = await rpc({ type: 'exchange-code', code });
    setView(res.ok ? 'login-done' : 'login');
    return;
  }
  setView('loading');
  const session = await rpc({ type: 'session' });
  if (!session.ok || !('session' in session) || !session.session.loggedIn) {
    setView('login');
    return;
  }
  const cap = await rpc({ type: 'capture-active-tab' });
  if (!cap.ok || !('capture' in cap) || cap.capture === null) {
    $('error-message').textContent = copy.popupCannotCapture;
    setView('error');
    return;
  }
  capture = cap.capture;
  mode = initialMode(capture);
  renderCapture();
  setView('capture');
}

for (const m of ['article', 'selection', 'task', 'file'] as const) {
  $(`mode-${m}`).addEventListener('click', () => {
    mode = m;
    renderCapture();
  });
}
$('save').addEventListener('click', commit);
$('open-recent').addEventListener('click', () => void showRecent());
$('recent-back').addEventListener('click', () => {
  if (capture === null) {
    $('error-message').textContent = copy.popupCannotCapture;
    setView('error');
    return;
  }
  setView('capture');
});
$('login-web').addEventListener('click', () => void rpc({ type: 'open-login' }));
$('logout').addEventListener('click', () => {
  void rpc({ type: 'logout' }).then(() => setView('login'));
});
$('error-retry').addEventListener('click', () => {
  // No capture in hand (e.g. capture-active-tab failed on a restricted page):
  // re-boot instead of showing an empty capture skeleton.
  if (capture === null) {
    void boot();
    return;
  }
  $<HTMLButtonElement>('save').disabled = false;
  setView('capture');
});
$('saved-done').addEventListener('click', () => window.close());
chrome.runtime.onMessage.addListener((message) => {
  if (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'session-changed'
  ) {
    if (handshakeDone) return;
    void boot();
  }
});

void boot();
