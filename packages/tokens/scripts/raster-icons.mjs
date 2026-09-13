#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';

const PULSE = '#0F8F8A';
const WHITE = '#FFFFFF';
/** 主标在白底上的占比（旧版满版深底 0.64 显得过大，收敛到主流 app 水平） */
const MARK_RATIO = 0.58;
/** Android adaptive foreground 安全区为中心 66/108，主标需再收敛 */
const FOREGROUND_RATIO = 0.55;

const tokensDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(tokensDir, '..', '..');

const canonical = readFileSync(join(tokensDir, 'src/logo.svg'), 'utf8');
const inner = canonical
  .replace(/<svg[^>]*>/, '')
  .replace('</svg>', '')
  .replaceAll('currentColor', PULSE)
  .trim();

/** 连续曲率圆角（squircle 近似），inset 为每边内缩像素 */
function squirclePath(size, inset, radiusPct = 0.24) {
  const r = (size - inset * 2) * radiusPct;
  const x0 = inset;
  const y0 = inset;
  const x1 = size - inset;
  const y1 = size - inset;
  return `M ${x0 + r} ${y0} H ${x1 - r} C ${x1 - r * 0.35} ${y0} ${x1} ${y0 + r * 0.35} ${x1} ${y0 + r} V ${y1 - r} C ${x1} ${y1 - r * 0.35} ${x1 - r * 0.35} ${y1} ${x1 - r} ${y1} H ${x0 + r} C ${x0 + r * 0.35} ${y1} ${x0} ${y1 - r * 0.35} ${x0} ${y1 - r} V ${y0 + r} C ${x0} ${y0 + r * 0.35} ${x0 + r * 0.35} ${y0} ${x0 + r} ${y0} Z`;
}

function markGroup(size, ratio) {
  const innerPx = size * ratio;
  const offset = (size - innerPx) / 2;
  return `<g fill="none" transform="translate(${offset} ${offset}) scale(${innerPx / 32})">${inner}</g>`;
}

/** 满版白底（iOS / apple-touch-icon / PWA：圆角由系统裁切，素材不可带透明） */
function fullBleedSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${WHITE}"/>
  ${markGroup(size, MARK_RATIO)}
</svg>`;
}

/** 烘焙圆角透明底（macOS / Windows / Linux / 扩展 / favicon） */
function roundedSvg(size, insetPct = 0.06) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#F6F7F8"/>
    </linearGradient>
  </defs>
  <path d="${squirclePath(size, size * insetPct)}" fill="url(#tile)" stroke="rgba(14,26,36,0.08)" stroke-width="${size * 0.006}"/>
  ${markGroup(size, MARK_RATIO)}
</svg>`;
}

/** 透明底纯主标（Android adaptive foreground / splash） */
function foregroundSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${markGroup(size, FOREGROUND_RATIO)}
</svg>`;
}

/** Black-on-transparent mark for macOS template tray / menu-bar extras. */
function traySvg(size) {
  const mark = inner.replaceAll(PULSE, '#000000');
  const innerPx = size * 0.82;
  const offset = (size - innerPx) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g fill="none" transform="translate(${offset} ${offset}) scale(${innerPx / 32})">${mark}</g>
</svg>`;
}

function render(svg, size, background) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    ...(background ? { background } : {}),
  });
  return resvg.render().asPng();
}

function writePng(path, size, svg, background) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, render(svg, size, background));
}

function writeFaviconSvg(path) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${roundedSvg(32)}\n`);
}

async function writeIco(path, sizes, insetPct) {
  const dir = mkdtempSync(join(tmpdir(), 'vital-ico-'));
  try {
    const pngs = sizes.map((size) => {
      const file = join(dir, `${size}.png`);
      writeFileSync(file, render(roundedSvg(size, insetPct), size));
      return file;
    });
    writeFileSync(path, await pngToIco(pngs));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeIcns(path) {
  const dir = mkdtempSync(join(tmpdir(), 'vital-iconset-'));
  const iconset = `${dir}.iconset`;
  mkdirSync(iconset, { recursive: true });
  const entries = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
  ];
  for (const [name, size] of entries) {
    // macOS Big Sur 风格：图标内容 824/1024，每边内缩约 10%
    writeFileSync(join(iconset, name), render(roundedSvg(size, 0.1), size));
  }
  execFileSync('iconutil', ['-c', 'icns', '-o', path, iconset]);
  rmSync(iconset, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
}

const webPublic = join(repoRoot, 'apps/web/public');
const extensionAssets = join(repoRoot, 'apps/extension/assets');
const desktopIcons = join(repoRoot, 'apps/desktop/src-tauri/icons');
const mobileAssets = join(repoRoot, 'apps/mobile/assets');

writeFaviconSvg(join(webPublic, 'favicon.svg'));
writePng(join(webPublic, 'apple-touch-icon.png'), 180, fullBleedSvg(180), WHITE);
writePng(join(webPublic, 'pwa-192.png'), 192, fullBleedSvg(192), WHITE);
writePng(join(webPublic, 'pwa-512.png'), 512, fullBleedSvg(512), WHITE);

writePng(join(extensionAssets, 'icon-16.png'), 16, roundedSvg(16));
writePng(join(extensionAssets, 'icon-32.png'), 32, roundedSvg(32));
writePng(join(extensionAssets, 'icon-48.png'), 48, roundedSvg(48));
writePng(join(extensionAssets, 'icon-128.png'), 128, roundedSvg(128));

writePng(join(desktopIcons, '16x16.png'), 16, roundedSvg(16));
writePng(join(desktopIcons, '32x32.png'), 32, roundedSvg(32));
writePng(join(desktopIcons, '128x128.png'), 128, roundedSvg(128));
writePng(join(desktopIcons, '128x128@2x.png'), 256, roundedSvg(256));
writePng(join(desktopIcons, '256x256.png'), 256, roundedSvg(256));
writePng(join(desktopIcons, 'icon.png'), 256, roundedSvg(256));
writeFileSync(join(desktopIcons, 'tray.png'), render(traySvg(64), 64));

writePng(join(mobileAssets, 'icon.png'), 1024, fullBleedSvg(1024), WHITE);
writePng(join(mobileAssets, 'adaptive-icon.png'), 1024, foregroundSvg(1024));
writePng(join(mobileAssets, 'splash-icon.png'), 1024, foregroundSvg(1024));

mkdirSync(join(webPublic, 'fonts'), { recursive: true });
cpSync(
  join(tokensDir, 'fonts/sora-latin-wght-normal.woff2'),
  join(webPublic, 'fonts/sora-latin-wght-normal.woff2'),
);
cpSync(join(tokensDir, 'fonts/OFL.txt'), join(webPublic, 'fonts/OFL.txt'));

await writeIco(join(webPublic, 'favicon.ico'), [16, 32, 48], 0.06);
await writeIco(join(desktopIcons, 'icon.ico'), [16, 32, 48, 256], 0.06);
writeIcns(join(desktopIcons, 'icon.icns'));

console.log('rasterized Vital mark into web/extension/desktop/mobile assets');
