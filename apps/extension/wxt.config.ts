import { defineConfig } from 'wxt';
import { fileURLToPath } from 'node:url';
import { resolveExtensionOrigins } from './origins';

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

const origins = resolveExtensionOrigins();

export default defineConfig({
  srcDir: '.',
  publicDir: 'assets',
  outDir: origins.outDir,
  imports: false,
  browser: 'chrome',
  zip: {
    name: 'vital',
    artifactTemplate: '{{name}}-{{version}}-{{browser}}.zip',
  },
  vite: () => ({
    define: {
      'import.meta.env.WXT_API_URL': JSON.stringify(origins.apiUrl),
      'import.meta.env.WXT_WEB_URL': JSON.stringify(origins.webUrl),
      'import.meta.env.WXT_S3_ENDPOINT': JSON.stringify(origins.s3),
    },
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
    const { apiUrl, webUrl, s3 } = origins;
    const webMatches = withLocalhostAlias(originPattern(webUrl));
    const hostPermissions = [...withLocalhostAlias(originPattern(apiUrl)), originPattern(s3)];
    return {
      name: 'Vital',
      description: 'Save pages, selections, and images to read later',
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
          description: 'Save the current page to Vital',
        },
        'save-and-edit': {
          description: 'Save and edit',
        },
      },
      action: {
        default_popup: 'popup.html',
        default_title: 'Save to Vital',
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
