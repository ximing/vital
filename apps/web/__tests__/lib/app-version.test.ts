import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '@/lib/app-version';

describe('APP_VERSION', () => {
  it('is inlined from apps/web/package.json at Vite build', () => {
    const pkg = JSON.parse(readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
