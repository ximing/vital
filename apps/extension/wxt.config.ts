import { defineConfig } from 'wxt';

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
  dev: {
    server: { port: 5181 },
  },
  manifest: () => {
    const apiUrl = process.env.WXT_API_URL ?? 'http://localhost:3010';
    const s3 = process.env.WXT_S3_ENDPOINT ?? 'https://s3.aimo.plus';
    const hostPermissions = [...withLocalhostAlias(originPattern(apiUrl)), originPattern(s3)];
    return {
      name: 'Vital',
      description: '把网页、选区和图片收到稍后读',
      minimum_chrome_version: '116',
      permissions: ['storage', 'activeTab', 'scripting', 'contextMenus', 'offscreen'],
      host_permissions: hostPermissions,
      action: {
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
