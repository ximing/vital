import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relative: string): string => readFileSync(path.resolve(root, relative), 'utf8');

describe('extension manifest contract', () => {
  it('declares Alt+Shift+V save-page and does not use a toolbar popup', () => {
    const config = read('wxt.config.ts');
    expect(config).toContain("'save-page'");
    expect(config).toContain('Alt+Shift+V');
    expect(config).toContain('externally_connectable');
    expect(config).toContain('web_accessible_resources');
    expect(config).not.toContain('default_popup');
  });
});
