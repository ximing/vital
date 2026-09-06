/// <reference types="node" />
import { readFileSync } from 'node:fs';
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

  it('Vite listens on 5180 and proxies /api to 127.0.0.1:3010', () => {
    const config = read('vite.config.ts');
    expect(config).toContain('port: 5180');
    expect(config).toContain("target: 'http://127.0.0.1:3010'");
    expect(config).toContain("'/api'");
    expect(config).toContain('strictPort: true');
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

<<<<<<< HEAD
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
    expect(app).toContain('/inbox/:id');
    expect(app).toContain('InboxWorkspace');
    expect(app).toContain('InboxReader');
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies.dompurify).toBeTruthy();
    const copy = read('src/copy.ts');
    expect(copy).toContain('把稍后读的页先丢进来。');
    expect(copy).toContain('打开一条稍后再读。');
    const client = read('src/api/client.ts');
    expect(client).toContain("authMode: 'cookie'");
  });

  it('reports live under features/reports with TipTap, source toggle, and empty copy', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('/reports/:id');
    expect(app).toContain('ReportsWorkspace');
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['@tiptap/starter-kit']).toContain('^2');
    expect(pkg.dependencies['@vital/markdown']).toBe('workspace:*');
    const copy = read('src/copy.ts');
    expect(copy).toContain('写今天的日报，把完成的事留下痕迹。');
    expect(copy).toContain('用 / 插入任务或稍后读。');
    expect(copy).toContain('从本周期填充');
    const ws = read('src/features/reports/ReportsWorkspace.tsx');
    const model = read('src/features/reports/model.ts');
    expect(ws).toContain('syncHead');
    expect(ws).toContain('getReportEmbeds');
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
    expect(shell).toContain('/search');
    expect(shell).not.toContain('to="/library"');
    expect(shell).not.toContain('即将推出');
    const palette = read('src/features/palette/model.ts');
    expect(palette).toContain('isPaletteToggle');
    expect(palette).toContain("event.key === 'k'");
    const search = read('src/features/search/SearchPage.tsx');
    expect(search).toContain(".search({ q, limit: 20 })");
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
});
