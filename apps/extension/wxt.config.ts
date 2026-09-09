import { defineConfig } from 'wxt';
import { fileURLToPath } from 'node:url';

function originPattern(raw: string): string {
  const url = new URL(raw);
  return `${url.origin}/*`;
}

function withLocalhostAlias(origin: string): string[] {
  const url = new URL(origin.replace(/\/\*$/, ''));
  const out = [`${url.origin}/*`];
  if (url.hostname === 'localhost') {
    out.push(`${url.protocol}//127.0.0.1${url.port ? `:${url.port}` : ''}/*`);
  } else if (url.hostname === '127.0.0.1') {
    out.push(`${url.protocol}//localhost${url.port ? `:${url.port}` : ''}/*`);
  }
  return out;
}

export default defineConfig({
  srcDir: '.',
  publicDir: 'assets',
  outDir: 'dist',
  imports: false,
  browser: 'chrome',
  vite: () => ({
    resolve: {
      alias: {
        '/fonts/sora-latin-wght-normal.woff2': fileURLToPath(
          new URL('../../packages/tokens/fonts/sora-latin-wght-normal.woff2', import.meta.url),
        ),
      },
    },
  }),
  dev: {
    server: { port: 5181 },
  },
  manifest: () => {
    const apiUrl = process.env.WXT_API_URL ?? 'http://localhost:3010';
    const webUrl = process.env.WXT_WEB_URL ?? 'http://localhost:5180';
    const s3 = process.env.WXT_S3_ENDPOINT ?? 'https://s3.aimo.plus';
    const webMatches = withLocalhostAlias(originPattern(webUrl));
    const hostPermissions = [...withLocalhostAlias(originPattern(apiUrl)), originPattern(s3)];
    return {
      name: 'Vital',
      description: '把网页、选区和图片收到稍后读',
      minimum_chrome_version: '127',
      permissions: ['storage', 'activeTab', 'scripting', 'contextMenus', 'offscreen'],
      host_permissions: hostPermissions,
      externally_connectable: { matches: webMatches },
      web_accessible_resources: [
        { resources: ['popup.html'], matches: webMatches },
      ],
      commands: {
        'save-page': {
          suggested_key: { default: 'Alt+Shift+V' },
          description: '保存当前页到 Vital',
        },
        'save-and-edit': {
          description: '保存并编辑',
        },
      },
      action: {
        default_popup: 'popup.html',
        default_title: '保存到 Vital',
        default_icon: {
          16: '/icon-16.png',
          32: '/icon-32.png',
          48: '/icon-48.png',
          128: '/icon-128.png',
        },
      },
      icons: {
        16: '/icon-16.png',
        32: '/icon-32.png',
        48: '/icon-48.png',
        128: '/icon-128.png',
      },
    };
  },
});
