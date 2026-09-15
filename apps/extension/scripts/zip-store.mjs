#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const extRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(extRoot, 'package.json'), 'utf8'));
const zipName = `vital-${pkg.version}-chrome.zip`;
const from = join(extRoot, 'dist-store', zipName);
const to = join(extRoot, 'store-listing', zipName);

const result = spawnSync('pnpm', ['exec', 'wxt', 'zip'], {
  cwd: extRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    VITAL_EXTENSION_TARGET: 'store',
    WXT_API_URL: 'https://vital.aimo.plus',
    WXT_WEB_URL: 'https://vital.aimo.plus',
    WXT_S3_ENDPOINT: 'https://s3.aimo.plus',
  },
});
if (result.status !== 0) process.exit(result.status ?? 1);

copyFileSync(from, to);
console.log(`Store zip → ${to}`);
