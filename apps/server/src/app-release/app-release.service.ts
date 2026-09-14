import { request } from 'undici';
import {
  androidReleaseFromGitHubRelease,
  appLatestFromGitHubRelease,
  type AndroidRelease,
  type AppLatestRelease,
} from '@vital/dto';
import { config, type Config } from '../config.js';
import { logger } from '../utils/logger.js';

const CACHE_MS = 60_000;
const GITHUB_API = 'https://api.github.com';
const DEFAULT_REPO = 'ximing/vital';

export type GitHubFetchJson = (
  url: string,
  headers: Record<string, string>,
) => Promise<{ status: number; body: unknown }>;

type ReleaseEnv = Pick<
  Config,
  'NODE_ENV' | 'GITHUB_RELEASES_REPO' | 'GITHUB_RELEASES_TOKEN' | 'ANDROID_RELEASE_MIN_VERSION_CODE'
>;

async function defaultFetch(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const res = await request(url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.body.text();
  if (text === '') return { status: res.statusCode, body: null };
  try {
    return { status: res.statusCode, body: JSON.parse(text) as unknown };
  } catch {
    return { status: res.statusCode, body: null };
  }
}

let fetchJson: GitHubFetchJson = defaultFetch;
let cache: { repo: string; at: number; value: AndroidRelease | null } | null = null;
let latestCache: { repo: string; at: number; value: AppLatestRelease | null } | null = null;

export function setGitHubReleaseFetchForTest(fn: GitHubFetchJson | undefined): void {
  fetchJson = fn ?? defaultFetch;
  cache = null;
  latestCache = null;
}

export function githubReleasesRepo(env: {
  NODE_ENV: Config['NODE_ENV'];
  GITHUB_RELEASES_REPO?: string | undefined;
}): string | undefined {
  if (env.GITHUB_RELEASES_REPO) return env.GITHUB_RELEASES_REPO;
  if (env.NODE_ENV === 'test') return undefined;
  return DEFAULT_REPO;
}

function githubHeaders(token: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'vital-server',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function withMinVersion(
  release: AndroidRelease,
  minVersionCode: number | undefined,
): AndroidRelease {
  if (minVersionCode === undefined || minVersionCode > release.versionCode) return release;
  return { ...release, minVersionCode };
}

export async function fetchAndroidReleaseFromGitHub(input: {
  repo: string;
  token?: string | undefined;
  minVersionCode?: number | undefined;
}): Promise<AndroidRelease | null> {
  const headers = githubHeaders(input.token);
  const latestUrl = `${GITHUB_API}/repos/${input.repo}/releases/latest`;
  const latest = await fetchJson(latestUrl, headers);
  let release = latest.status === 200 ? androidReleaseFromGitHubRelease(latest.body) : null;
  if (!release) {
    const list = await fetchJson(`${GITHUB_API}/repos/${input.repo}/releases?per_page=10`, headers);
    if (list.status === 200 && Array.isArray(list.body)) {
      for (const item of list.body) {
        release = androidReleaseFromGitHubRelease(item);
        if (release) break;
      }
    }
  }
  if (!release) {
    if (latest.status >= 400 && latest.status !== 404) {
      logger.warn('android_release.github_failed', { status: latest.status, repo: input.repo });
    }
    return null;
  }
  return withMinVersion(release, input.minVersionCode);
}

export async function resolveAndroidRelease(env: ReleaseEnv = config): Promise<AndroidRelease | null> {
  const repo = githubReleasesRepo(env);
  if (!repo) return null;
  const now = Date.now();
  if (cache && cache.repo === repo && now - cache.at < CACHE_MS) return cache.value;
  try {
    const value = await fetchAndroidReleaseFromGitHub({
      repo,
      token: env.GITHUB_RELEASES_TOKEN,
      minVersionCode: env.ANDROID_RELEASE_MIN_VERSION_CODE,
    });
    cache = { repo, at: now, value };
    return value;
  } catch (err) {
    logger.warn('android_release.github_error', err);
    if (cache && cache.repo === repo) return cache.value;
    return null;
  }
}

async function firstMappedRelease(
  repo: string,
  token: string | undefined,
  map: (body: unknown) => AppLatestRelease | AndroidRelease | null,
): Promise<unknown> {
  const headers = githubHeaders(token);
  const latestUrl = `${GITHUB_API}/repos/${repo}/releases/latest`;
  const latest = await fetchJson(latestUrl, headers);
  const fromLatest = map(latest.body);
  if (fromLatest) return latest.body;
  const list = await fetchJson(`${GITHUB_API}/repos/${repo}/releases?per_page=10`, headers);
  if (list.status === 200 && Array.isArray(list.body)) {
    for (const item of list.body) {
      if (map(item)) return item;
    }
  }
  if (latest.status >= 400 && latest.status !== 404) {
    logger.warn('app_release.github_failed', { status: latest.status, repo });
  }
  return null;
}

export async function resolveAppLatest(env: ReleaseEnv = config): Promise<AppLatestRelease | null> {
  const repo = githubReleasesRepo(env);
  if (!repo) return null;
  const now = Date.now();
  if (latestCache && latestCache.repo === repo && now - latestCache.at < CACHE_MS) {
    return latestCache.value;
  }
  try {
    const body = await firstMappedRelease(repo, env.GITHUB_RELEASES_TOKEN, appLatestFromGitHubRelease);
    const value = body ? appLatestFromGitHubRelease(body) : null;
    latestCache = { repo, at: now, value };
    return value;
  } catch (err) {
    logger.warn('app_release.github_error', err);
    if (latestCache && latestCache.repo === repo) return latestCache.value;
    return null;
  }
}
