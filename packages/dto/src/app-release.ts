import { z } from 'zod';

function emptyToUndef<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => {
    if (value === '' || value === null) return undefined;
    return value;
  }, schema.optional());
}

const sha256Schema = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{64}$/)
  .transform((value) => value.toLowerCase());

export const androidReleaseSchema = z
  .object({
    versionName: z.string().trim().min(1).max(32),
    versionCode: z.coerce.number().int().positive(),
    apkUrl: z.string().trim().url().max(2048),
    sha256: emptyToUndef(sha256Schema),
    sizeBytes: emptyToUndef(z.coerce.number().int().positive()),
    releaseNotes: emptyToUndef(z.string().trim().max(4000)),
    minVersionCode: emptyToUndef(z.coerce.number().int().positive()),
  })
  .refine(
    (value) => value.minVersionCode === undefined || value.minVersionCode <= value.versionCode,
    { message: 'minVersionCode must be <= versionCode', path: ['minVersionCode'] },
  );

export interface AndroidRelease {
  versionName: string;
  versionCode: number;
  apkUrl: string;
  sha256?: string | undefined;
  sizeBytes?: number | undefined;
  releaseNotes?: string | undefined;
  minVersionCode?: number | undefined;
}

export interface AppAndroidReleaseResponse {
  android: AndroidRelease | null;
}

export const appAndroidReleaseResponseSchema = z.object({
  android: androidReleaseSchema.nullable(),
});

export function parseAndroidRelease(input: unknown): AndroidRelease | null {
  const parsed = androidReleaseSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/** Same formula as `.github/workflows/android-release.yml`: vMAJOR.MINOR.PATCH. */
export function androidVersionFromTag(
  tag: string,
): { versionName: string; versionCode: number } | null {
  const match = /^v?([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(tag.trim());
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) return null;
  if (minor > 99 || patch > 99) return null;
  const versionCode = major * 10_000 + minor * 100 + patch;
  if (versionCode < 1) return null;
  return { versionName: `${String(major)}.${String(minor)}.${String(patch)}`, versionCode };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function pickGitHubApkAsset(
  assets: unknown,
): { name: string; apkUrl: string; sizeBytes?: number } | null {
  if (!Array.isArray(assets)) return null;
  const apks: { name: string; apkUrl: string; sizeBytes?: number }[] = [];
  for (const item of assets) {
    if (!isRecord(item)) continue;
    const name = typeof item.name === 'string' ? item.name : '';
    const url = typeof item.browser_download_url === 'string' ? item.browser_download_url : '';
    if (!name.toLowerCase().endsWith('.apk') || url === '') continue;
    const size = typeof item.size === 'number' && Number.isFinite(item.size) && item.size > 0 ? item.size : undefined;
    apks.push(size === undefined ? { name, apkUrl: url } : { name, apkUrl: url, sizeBytes: size });
  }
  if (apks.length === 0) return null;
  return apks.find((asset) => asset.name === 'app-release.apk') ?? apks[0] ?? null;
}

/** Map a GitHub Releases API payload (one release) to Android APK metadata. */
export function androidReleaseFromGitHubRelease(input: unknown): AndroidRelease | null {
  if (!isRecord(input)) return null;
  if (input.draft === true || input.prerelease === true) return null;
  const tag = typeof input.tag_name === 'string' ? input.tag_name : '';
  const version = androidVersionFromTag(tag);
  if (!version) return null;
  const apk = pickGitHubApkAsset(input.assets);
  if (!apk) return null;
  const notes = typeof input.body === 'string' ? input.body.trim().slice(0, 4000) : '';
  return parseAndroidRelease({
    versionName: version.versionName,
    versionCode: version.versionCode,
    apkUrl: apk.apkUrl,
    sizeBytes: apk.sizeBytes,
    releaseNotes: notes === '' ? undefined : notes,
  });
}

export const desktopAssetIdSchema = z.enum([
  'macos-arm',
  'macos-intel',
  'windows-exe',
  'windows-msi',
  'linux-deb',
  'linux-appimage',
  'linux-rpm',
]);
export type DesktopAssetId = z.infer<typeof desktopAssetIdSchema>;

export const desktopAssetSchema = z.object({
  id: desktopAssetIdSchema,
  url: z.string().url().max(2048),
  name: z.string().trim().min(1).max(200),
  sizeBytes: emptyToUndef(z.coerce.number().int().positive()),
});
export type DesktopAsset = z.infer<typeof desktopAssetSchema>;

export const appLatestReleaseSchema = z.object({
  versionName: z.string().trim().min(1).max(32),
  tag: z.string().trim().min(1).max(32),
  htmlUrl: z.string().url().max(2048).nullable(),
  publishedAt: z.string().min(1).max(40).nullable(),
  android: androidReleaseSchema.nullable(),
  desktop: z.array(desktopAssetSchema).max(16),
});
export type AppLatestRelease = z.infer<typeof appLatestReleaseSchema>;

export const appLatestReleaseResponseSchema = z.object({
  latest: appLatestReleaseSchema.nullable(),
});
export type AppLatestReleaseResponse = z.infer<typeof appLatestReleaseResponseSchema>;

/** Classify a GitHub asset filename into a desktop installer id. Skip updater tarballs. */
export function classifyDesktopAsset(name: string): DesktopAssetId | null {
  const n = name.toLowerCase();
  if (n.endsWith('.tar.gz') || n.endsWith('.tgz')) return null;
  if (n.endsWith('.dmg')) {
    if (n.includes('aarch64') || n.includes('arm64')) return 'macos-arm';
    return 'macos-intel';
  }
  if (n.endsWith('.msi')) return 'windows-msi';
  if (n.endsWith('.exe')) return 'windows-exe';
  if (n.endsWith('.deb')) return 'linux-deb';
  if (n.endsWith('.appimage')) return 'linux-appimage';
  if (n.endsWith('.rpm')) return 'linux-rpm';
  return null;
}

function pickDesktopAssets(assets: unknown): DesktopAsset[] {
  if (!Array.isArray(assets)) return [];
  const found = new Map<DesktopAssetId, DesktopAsset>();
  for (const item of assets) {
    if (!isRecord(item)) continue;
    const name = typeof item.name === 'string' ? item.name : '';
    const url = typeof item.browser_download_url === 'string' ? item.browser_download_url : '';
    const id = classifyDesktopAsset(name);
    if (!id || url === '') continue;
    const size =
      typeof item.size === 'number' && Number.isFinite(item.size) && item.size > 0
        ? item.size
        : undefined;
    if (found.has(id)) continue;
    found.set(id, size === undefined ? { id, url, name } : { id, url, name, sizeBytes: size });
  }
  return [...found.values()];
}

/** Map a GitHub release to the public download catalog (Android + desktop). */
export function appLatestFromGitHubRelease(input: unknown): AppLatestRelease | null {
  if (!isRecord(input)) return null;
  if (input.draft === true || input.prerelease === true) return null;
  const tag = typeof input.tag_name === 'string' ? input.tag_name : '';
  const version = androidVersionFromTag(tag);
  if (!version) return null;
  const android = androidReleaseFromGitHubRelease(input);
  const desktop = pickDesktopAssets(input.assets);
  if (android === null && desktop.length === 0) return null;
  const htmlUrl = typeof input.html_url === 'string' && input.html_url.startsWith('https://') ? input.html_url : null;
  const publishedRaw = typeof input.published_at === 'string' ? input.published_at : null;
  const publishedAt =
    publishedRaw && Number.isFinite(Date.parse(publishedRaw)) ? new Date(publishedRaw).toISOString() : null;
  const parsed = appLatestReleaseSchema.safeParse({
    versionName: version.versionName,
    tag: tag.startsWith('v') ? tag : `v${version.versionName}`,
    htmlUrl,
    publishedAt,
    android,
    desktop,
  });
  return parsed.success ? parsed.data : null;
}
