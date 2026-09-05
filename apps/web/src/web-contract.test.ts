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
