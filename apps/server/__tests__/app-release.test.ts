import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
import {
  fetchAndroidReleaseFromGitHub,
  githubReleasesRepo,
  setGitHubReleaseFetchForTest,
} from '../src/app-release/app-release.service.js';

const apkUrl = 'https://github.com/ximing/vital/releases/download/v0.3.0/app-release.apk';

const githubRelease = {
  tag_name: 'v0.3.0',
  draft: false,
  prerelease: false,
  body: '后台下载',
  assets: [{ name: 'app-release.apk', browser_download_url: apkUrl, size: 73670279 }],
};

let app: FastifyInstance;

beforeAll(async () => {
  setGitHubReleaseFetchForTest(() => Promise.resolve({ status: 404, body: { message: 'Not Found' } }));
  app = await buildFastify();
});

afterEach(() => {
  setGitHubReleaseFetchForTest(() => Promise.resolve({ status: 404, body: { message: 'Not Found' } }));
});

afterAll(async () => {
  setGitHubReleaseFetchForTest(undefined);
  await app.close();
});

describe('android release', () => {
  it('GET /api/v1/app/android is public and returns null without a GitHub release', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/app/android' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ android: null });
  });

  it('defaults the GitHub repo outside tests', () => {
    expect(githubReleasesRepo({ NODE_ENV: 'test' })).toBeUndefined();
    expect(githubReleasesRepo({ NODE_ENV: 'production' })).toBe('ximing/vital');
    expect(githubReleasesRepo({ NODE_ENV: 'production', GITHUB_RELEASES_REPO: 'acme/app' })).toBe(
      'acme/app',
    );
  });

  it('reads the latest GitHub release APK and walks the list when latest has none', async () => {
    setGitHubReleaseFetchForTest((url) => {
      if (url.endsWith('/releases/latest')) {
        return Promise.resolve({ status: 200, body: githubRelease });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    await expect(
      fetchAndroidReleaseFromGitHub({ repo: 'ximing/vital', minVersionCode: 1 }),
    ).resolves.toEqual({
      versionName: '0.3.0',
      versionCode: 300,
      apkUrl,
      sizeBytes: 73670279,
      releaseNotes: '后台下载',
      minVersionCode: 1,
    });

    setGitHubReleaseFetchForTest((url) => {
      if (url.endsWith('/releases/latest')) {
        return Promise.resolve({ status: 200, body: { ...githubRelease, assets: [] } });
      }
      if (url.includes('/releases?')) {
        return Promise.resolve({
          status: 200,
          body: [{ ...githubRelease, tag_name: 'v0.2.0', assets: [] }, githubRelease],
        });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    await expect(fetchAndroidReleaseFromGitHub({ repo: 'ximing/vital' })).resolves.toMatchObject({
      versionName: '0.3.0',
      apkUrl,
    });
  });

  it('returns null when GitHub has no APK', async () => {
    setGitHubReleaseFetchForTest(() => Promise.resolve({ status: 404, body: { message: 'Not Found' } }));
    await expect(fetchAndroidReleaseFromGitHub({ repo: 'ximing/vital' })).resolves.toBeNull();
  });
});
