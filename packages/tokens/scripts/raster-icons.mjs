#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';

const INK = '#0E1A24';
const PULSE = '#0F8F8A';
const MARK_RATIO = 0.64;

const tokensDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(tokensDir, '..', '..');

const canonical = readFileSync(join(tokensDir, 'src/logo.svg'), 'utf8');
const inner = canonical
  .replace(/<svg[^>]*>/, '')
  .replace('</svg>', '')
  .replaceAll('currentColor', PULSE)
  .trim();

function iconSvg(size) {
  const innerPx = size * MARK_RATIO;
  const offset = (size - innerPx) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${INK}"/>
  <svg x="${offset}" y="${offset}" width="${innerPx}" height="${innerPx}" viewBox="0 0 32 32" fill="none">${inner}</svg>
</svg>`;
}

function renderPng(size) {
  const resvg = new Resvg(iconSvg(size), {
    fitTo: { mode: 'width', value: size },
    background: INK,
  });
  return resvg.render().asPng();
}

function writePng(path, size) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderPng(size));
}

function writeFaviconSvg(path) {
  const size = 32;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${iconSvg(size)}\n`);
}

async function writeIco(path, sizes) {
  const dir = mkdtempSync(join(tmpdir(), 'vital-ico-'));
  try {
    const pngs = sizes.map((size) => {
      const file = join(dir, `${size}.png`);
      writeFileSync(file, renderPng(size));
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
    writeFileSync(join(iconset, name), renderPng(size));
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
writePng(join(webPublic, 'apple-touch-icon.png'), 180);
writePng(join(webPublic, 'pwa-192.png'), 192);
writePng(join(webPublic, 'pwa-512.png'), 512);

writePng(join(extensionAssets, 'icon-16.png'), 16);
writePng(join(extensionAssets, 'icon-32.png'), 32);
writePng(join(extensionAssets, 'icon-48.png'), 48);
writePng(join(extensionAssets, 'icon-128.png'), 128);

writePng(join(desktopIcons, '32x32.png'), 32);
writePng(join(desktopIcons, '128x128.png'), 128);
writePng(join(desktopIcons, '256x256.png'), 256);
writePng(join(desktopIcons, 'icon.png'), 256);

writePng(join(mobileAssets, 'icon.png'), 1024);
writePng(join(mobileAssets, 'adaptive-icon.png'), 1024);
writePng(join(mobileAssets, 'splash-icon.png'), 1024);

mkdirSync(join(webPublic, 'fonts'), { recursive: true });
cpSync(
  join(tokensDir, 'fonts/sora-latin-wght-normal.woff2'),
  join(webPublic, 'fonts/sora-latin-wght-normal.woff2'),
);
cpSync(join(tokensDir, 'fonts/OFL.txt'), join(webPublic, 'fonts/OFL.txt'));

await writeIco(join(webPublic, 'favicon.ico'), [32]);
await writeIco(join(desktopIcons, 'icon.ico'), [16, 32, 48, 256]);
writeIcns(join(desktopIcons, 'icon.icns'));

console.log('rasterized Vital mark into web/extension/desktop/mobile assets');
