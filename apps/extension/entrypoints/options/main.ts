import type { InboxItem, UserProfile } from '@vital/dto';
import type { PanelRequest, PanelResponse } from '../../src/messages.js';

const loginView = document.getElementById('login-view');
const homeView = document.getElementById('home-view');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const empty = document.getElementById('empty');
const itemsEl = document.getElementById('items');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');

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

function setLoggedIn(on: boolean): void {
  show(loginView, !on);
  show(homeView, on);
}

function renderItems(items: InboxItem[]): void {
  if (itemsEl === null || empty === null) return;
  itemsEl.replaceChildren();
  show(empty, items.length === 0);
  for (const item of items) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'item';
    a.href = item.originalUrl ?? '#';
    a.target = '_blank';
    a.rel = 'noreferrer';
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = item.title;
    const url = document.createElement('span');
    url.className = 'url';
    url.textContent = item.originalUrl ?? '';
    a.append(title, url);
    li.append(a);
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

function applySession(
  session: { loggedIn: false } | { loggedIn: true; profile: UserProfile },
): void {
  setLoggedIn(session.loggedIn);
  if (session.loggedIn) void loadRecent();
}

async function boot(): Promise<void> {
  const res = await rpc({ type: 'session' });
  if (res.ok && 'session' in res) {
    applySession(res.session);
    return;
  }
  setLoggedIn(false);
}

loginForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!(emailInput instanceof HTMLInputElement) || !(passwordInput instanceof HTMLInputElement)) {
    return;
  }
  show(loginError, false);
  void rpc({ type: 'login', email: emailInput.value, password: passwordInput.value }).then(
    (res) => {
      if (res.ok && 'session' in res) {
        applySession(res.session);
        return;
      }
      if (loginError !== null) {
        loginError.textContent = res.ok ? '登录失败' : res.error;
        show(loginError, true);
      }
    },
  );
});

document.getElementById('logout')?.addEventListener('click', () => {
  void rpc({ type: 'logout' }).then(() => {
    setLoggedIn(false);
  });
});

document.getElementById('open-web')?.addEventListener('click', () => {
  void rpc({ type: 'open-web' });
});

void boot();
