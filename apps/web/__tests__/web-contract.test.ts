/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const webRoot = process.cwd();
const read = (relative: string): string => readFileSync(path.resolve(webRoot, relative), 'utf8');

describe('web shell contract', () => {
  it('index.html applies vital:theme before paint and preloads Sora', () => {
    const html = read('index.html');
    expect(html).toContain('lang="zh-CN"');
    expect(html).toContain("localStorage.getItem('vital:theme')");
    expect(html).toContain('document.documentElement.dataset.theme');
    expect(html).toContain('href="/fonts/sora-latin-wght-normal.woff2"');
    expect(html).toContain('rel="preload"');
  });

  it('desktop titlebar stays native and follows the resolved light/dark scheme', () => {
    const theme = read('src/lib/theme.ts');
    expect(theme).toContain('setTheme');
    expect(theme).toContain('setBackgroundColor');
    expect(theme).toContain('@tauri-apps/api/window');
    expect(theme).toContain('bgCanvas');
    const main = read('src/main.tsx');
    expect(main).toContain('applyTheme()');
  });

  it('Vite listens on 5180 and proxies /api to 127.0.0.1:3010', () => {
    const config = read('vite.config.ts');
    expect(config).toContain('port: 5180');
    expect(config).toContain("target: 'http://127.0.0.1:3010'");
    expect(config).toContain("'/api'");
    expect(config).toContain('strictPort: true');
  });

  it('bakes package.json version into the client as VITE_APP_VERSION', () => {
    const config = read('vite.config.ts');
    expect(config).toContain('VITE_APP_VERSION');
    expect(config).toContain('package.json');
    expect(read('src/vite-env.d.ts')).toContain('VITE_APP_VERSION');
    expect(read('src/lib/app-version.ts')).toContain('import.meta.env.VITE_APP_VERSION');
    expect(read('src/pages/settings.tsx')).toContain('APP_VERSION');
  });

  it('pins React 19.1.0 and Vite 6', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.dependencies.react).toBe('19.1.0');
    expect(pkg.dependencies['react-dom']).toBe('19.1.0');
    expect(pkg.devDependencies.vite).toContain('^6');
  });

  it('cookie client is relative and credentials live in api-client cookie mode', () => {
    const client = read('src/api/client.ts');
    expect(client).toContain("baseUrl: ''");
    expect(client).toContain("authMode: 'cookie'");
    expect(client).toContain('vital:auth-cleared');
    expect(client).not.toContain('localStorage');
  });

  it('shell is a viewport-height flex row so rail and library span the window', () => {
    const shell = read('src/shell/Shell.tsx');
    expect(shell).toContain('h-full');
    expect(shell).toContain('overflow-hidden');
    expect(shell).not.toContain('fixed inset-y-0');
    // Viewport height lives on the layout element in app.css (100dvh), not on Shell.
    const css = read('src/styles/app.css');
    expect(css).toMatch(/\[data-layout='mineral-garden'\][^}]*height:\s*100dvh/);
    expect(css).toMatch(/\[data-layout='mineral-garden'\][^}]*overflow:\s*hidden/);
    const pane = read('src/shell/SecondaryPane.tsx');
    expect(pane).toContain('h-full');
    expect(pane).not.toContain('fixed inset-y-0');
  });

  it('browser / is the marketing page; desktop / goes to login or today', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('isTauriRuntime()');
    expect(app).toContain('RootEntry');
    expect(app).toContain('LandingPage');
    expect(app).toMatch(/path="\/"/);
    const auth = read('src/shell/require-auth.tsx');
    expect(auth).toContain('Navigate to="/login"');
    expect(auth).toContain('HOME_PATH');
    const copy = read('src/copy.ts');
    const routes = read('src/routes.ts');
    expect(routes).toContain("HOME_PATH = '/today'");
    expect(copy).not.toContain('HOME_PATH');
    expect(copy).not.toContain('LANDING_PATH');
    expect(copy).toContain('打开后，先看到');
    expect(copy).toContain('下载最新版本');
  });

  it('todos live under features/todos with smart:today and keyboard keys', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('/todos/lists/:listId');
    expect(app).toContain('TodosWorkspace');
    const kb = read('src/features/todos/keyboard.ts');
    for (const key of ["'n'", "'j'", "'k'", "'Enter'", "'e'", "'/'", "'t'", "'1'"]) {
      expect(kb).toContain(key);
    }
    expect(kb).toContain('if (event.metaKey || event.ctrlKey || event.altKey) return');
    const copy = read('src/copy.ts');
    expect(copy).toContain('今天还没有安排，也没有逾期。按 N 新建。');
  });

  it('inbox lives under features/inbox with reader, convert, and empty copy', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('path="/inbox"');
    expect(app).toContain('path=":id"');
    expect(app).toContain('/auth/extension');
    expect(app).toContain('InboxWorkspace');
    expect(app).toContain('InboxReader');
    expect(app).toContain('lazy(');
    expect(app).toContain('Suspense');
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    // Sanitize/bundle lives in the shared @vital/article-doc package now.
    expect(pkg.dependencies['@vital/article-doc']).toBeTruthy();
    const copy = read('src/copy.ts');
    expect(copy).toContain('把值得重读的东西，先安静地放在这里。');
    expect(copy).toContain('打开一条稍后再读。');
    const client = read('src/api/client.ts');
    expect(client).toContain("authMode: 'cookie'");
  });

  it('reports live under features/reports with TipTap and empty copy', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('/reports/:id');
    expect(app).toContain('ReportsWorkspace');
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['@tiptap/starter-kit']).toContain('^2');
    expect(pkg.dependencies['@vital/markdown']).toBe('workspace:*');
    const copy = read('src/copy.ts');
    expect(copy).toContain('今天想留下一句就够。');
    expect(copy).toContain('格子深浅是完成多少');
    expect(copy).toContain('一键生成');
    const ws = read('src/features/reports/ReportsWorkspace.tsx');
    const model = read('src/features/reports/model.ts');
    expect(ws).toContain('syncHead');
    expect(ws).toContain('getReportEmbeds');
    expect(ws).toContain('StatsBlock');
    expect(model).toContain('REPORT_REVISION_CONFLICT');
    expect(ws).not.toContain("authMode: 'bearer'");
  });

  it('onboarding, search UI, ⌘K palette, and no coming-soon nav', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('/onboarding');
    expect(app).toContain('OnboardingPage');
    expect(app).toContain('SearchPage');
    expect(app).not.toContain('LibraryPage');
    const shell = read('src/shell/Shell.tsx');
    expect(shell).toContain('CommandPalette');
    // 侧栏搜索入口是打开命令面板的按钮（/search 页面仍在，由面板命令进入）。
    expect(shell).toContain('OPEN_PALETTE_EVENT');
    expect(shell).not.toContain('to="/library"');
    expect(shell).not.toContain('即将推出');
    const palette = read('src/features/palette/model.ts');
    expect(palette).toContain('isPaletteToggle');
    expect(palette).toContain("event.key === 'k'");
    expect(palette).toContain('searchResultsToItems');
    const search = read('src/features/search/search-page.service.ts');
    expect(search).toContain('.search({ q, limit: 20 })');
    const copy = read('src/copy.ts');
    expect(copy).toContain('输入关键词搜任务、稍后读和报告。');
  });

  it('Tauri runtime uses bearer plugin-http + plugin-store and an absolute baseUrl', () => {
    const client = read('src/api/client.ts');
    expect(client).toContain('__TAURI_INTERNALS__');
    expect(client).toContain("authMode: 'bearer'");
    expect(client).toContain('@tauri-apps/plugin-http');
    expect(client).toContain('@tauri-apps/plugin-store');
    expect(client).toContain('http://127.0.0.1:3010');
    expect(client).toContain('VITE_TAURI_API_URL');
    expect(client).toContain('tauriFetch');
  });

  it('local notify uses window.Notification so the Tauri plugin can patch it', () => {
    const notify = read('src/features/notify/browser-notify.service.ts');
    expect(notify).toContain('new Ctor(title');
    expect(notify).toContain('requireInteraction: true');
    expect(notify).toContain('showStickyAlert');
    expect(notify).toContain('stickyEnabled');
    expect(notify).toContain('setStickyEnabled');
    expect(notify).not.toContain('@tauri-apps/plugin-notification');
    const sticky = read('src/features/notify/sticky-alert.ts');
    expect(sticky).toContain('STICKY_ALERT_PREF_KEY');
    expect(sticky).toContain('vital:sticky-alert');
    const section = read('src/features/settings/NotificationsSection.tsx');
    expect(section).toContain('isTauriRuntime');
    expect(section).toContain('copy.desktop');
    expect(section).toContain('copy.sticky');
    expect(section).toContain('copy.preview');
    const main = read('src/main.tsx');
    expect(main).toContain('isNotifyAlertRuntime');
    expect(main).toContain('NotifyAlertPage');
  });

  it('does not use native window.alert, window.prompt, or window.confirm', () => {
    const srcRoot = path.resolve(webRoot, 'src');
    const files = readdirSync(srcRoot, { recursive: true, encoding: 'utf8' }).filter(
      (file) => file.endsWith('.ts') || file.endsWith('.tsx'),
    );
    const hits = files.filter((file) =>
      /\bwindow\.(alert|prompt|confirm)\s*\(/.test(readFileSync(path.join(srcRoot, file), 'utf8')),
    );
    expect(hits).toEqual([]);
  });
});
