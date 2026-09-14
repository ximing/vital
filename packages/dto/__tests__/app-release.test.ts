import { describe, expect, it } from 'vitest';
import {
  androidReleaseFromGitHubRelease,
  androidReleaseSchema,
  androidVersionFromTag,
  appLatestFromGitHubRelease,
  classifyDesktopAsset,
  parseAndroidRelease,
  pickGitHubApkAsset,
} from '../src/app-release.js';

const valid = {
  versionName: '1.2.0',
  versionCode: 10200,
  apkUrl: 'https://github.com/ximing/vital/releases/download/v1.2.0/app-release.apk',
};

describe('android release dto', () => {
  it('accepts a minimal release and lowercases sha256', () => {
    const parsed = androidReleaseSchema.parse({
      ...valid,
      sha256: 'A'.repeat(64),
      releaseNotes: '  修复同步  ',
    });
    expect(parsed.sha256).toBe('a'.repeat(64));
    expect(parsed.releaseNotes).toBe('修复同步');
  });

  it('coerces numeric strings and drops empty optionals', () => {
    const parsed = androidReleaseSchema.parse({
      versionName: '1.0.0',
      versionCode: '3',
      apkUrl: valid.apkUrl,
      sha256: '',
      sizeBytes: '',
      releaseNotes: '',
    });
    expect(parsed.versionCode).toBe(3);
    expect(parsed.sha256).toBeUndefined();
    expect(parsed.sizeBytes).toBeUndefined();
    expect(parsed.releaseNotes).toBeUndefined();
  });

  it('rejects minVersionCode above versionCode and incomplete payloads', () => {
    expect(() => androidReleaseSchema.parse({ ...valid, minVersionCode: 10201 })).toThrow();
    expect(parseAndroidRelease({})).toBeNull();
    expect(parseAndroidRelease({ versionName: '1.0.0' })).toBeNull();
  });

  it('parses release tags the same way as android-release.yml', () => {
    expect(androidVersionFromTag('v0.3.0')).toEqual({ versionName: '0.3.0', versionCode: 300 });
    expect(androidVersionFromTag('1.2.3')).toEqual({ versionName: '1.2.3', versionCode: 10203 });
    expect(androidVersionFromTag('v0.0.0')).toBeNull();
    expect(androidVersionFromTag('nightly')).toBeNull();
  });

  it('picks app-release.apk from GitHub assets', () => {
    expect(
      pickGitHubApkAsset([
        {
          name: 'Vital_0.3.0_amd64.deb',
          browser_download_url: 'https://github.com/ximing/vital/releases/download/v0.3.0/Vital_0.3.0_amd64.deb',
        },
        {
          name: 'app-release.apk',
          browser_download_url: valid.apkUrl.replace('v1.2.0', 'v0.3.0'),
          size: 73670279,
        },
      ]),
    ).toEqual({
      name: 'app-release.apk',
      apkUrl: 'https://github.com/ximing/vital/releases/download/v0.3.0/app-release.apk',
      sizeBytes: 73670279,
    });
    expect(pickGitHubApkAsset([])).toBeNull();
  });

  it('maps a GitHub release payload and skips drafts', () => {
    const payload = {
      tag_name: 'v0.3.0',
      draft: false,
      prerelease: false,
      body: '后台下载并安装更新',
      assets: [
        {
          name: 'app-release.apk',
          browser_download_url: 'https://github.com/ximing/vital/releases/download/v0.3.0/app-release.apk',
          size: 10,
        },
      ],
    };
    expect(androidReleaseFromGitHubRelease(payload)).toEqual({
      versionName: '0.3.0',
      versionCode: 300,
      apkUrl: 'https://github.com/ximing/vital/releases/download/v0.3.0/app-release.apk',
      sizeBytes: 10,
      releaseNotes: '后台下载并安装更新',
    });
    expect(androidReleaseFromGitHubRelease({ ...payload, draft: true })).toBeNull();
    expect(androidReleaseFromGitHubRelease({ ...payload, prerelease: true })).toBeNull();
    expect(androidReleaseFromGitHubRelease({ ...payload, assets: [] })).toBeNull();
  });
});

describe('desktop release assets', () => {
  it('classifies Tauri installer names and skips updater tarballs', () => {
    expect(classifyDesktopAsset('Vital_0.3.1_aarch64.dmg')).toBe('macos-arm');
    expect(classifyDesktopAsset('Vital_0.3.1_x64.dmg')).toBe('macos-intel');
    expect(classifyDesktopAsset('Vital_0.3.1_x64-setup.exe')).toBe('windows-exe');
    expect(classifyDesktopAsset('Vital_0.3.1_x64_en-US.msi')).toBe('windows-msi');
    expect(classifyDesktopAsset('Vital_0.3.1_amd64.deb')).toBe('linux-deb');
    expect(classifyDesktopAsset('Vital_0.3.1_amd64.AppImage')).toBe('linux-appimage');
    expect(classifyDesktopAsset('Vital-0.3.1-1.x86_64.rpm')).toBe('linux-rpm');
    expect(classifyDesktopAsset('Vital_0.3.1_aarch64.app.tar.gz')).toBeNull();
    expect(classifyDesktopAsset('app-release.apk')).toBeNull();
  });

  it('maps a mixed GitHub release into the public catalog', () => {
    const catalog = appLatestFromGitHubRelease({
      tag_name: 'v0.3.1',
      html_url: 'https://github.com/ximing/vital/releases/tag/v0.3.1',
      published_at: '2026-09-14T00:00:00Z',
      draft: false,
      prerelease: false,
      body: 'desktop + apk',
      assets: [
        {
          name: 'app-release.apk',
          browser_download_url: 'https://github.com/ximing/vital/releases/download/v0.3.1/app-release.apk',
          size: 10,
        },
        {
          name: 'Vital_0.3.1_aarch64.dmg',
          browser_download_url: 'https://github.com/ximing/vital/releases/download/v0.3.1/Vital_0.3.1_aarch64.dmg',
          size: 20,
        },
        {
          name: 'Vital_0.3.1_x64-setup.exe',
          browser_download_url: 'https://github.com/ximing/vital/releases/download/v0.3.1/Vital_0.3.1_x64-setup.exe',
          size: 30,
        },
        {
          name: 'Vital_0.3.1_aarch64.app.tar.gz',
          browser_download_url: 'https://github.com/ximing/vital/releases/download/v0.3.1/Vital_0.3.1_aarch64.app.tar.gz',
          size: 40,
        },
      ],
    });
    expect(catalog?.versionName).toBe('0.3.1');
    expect(catalog?.android?.apkUrl).toContain('app-release.apk');
    expect(catalog?.desktop.map((item) => item.id)).toEqual(['macos-arm', 'windows-exe']);
    expect(catalog?.htmlUrl).toContain('/tag/v0.3.1');
  });
});
