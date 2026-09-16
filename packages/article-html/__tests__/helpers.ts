import DOMPurify from 'dompurify';
import sanitizeHtml from 'sanitize-html';
import { expect } from 'vitest';
import { ENGINE_ALLOWED_TAG_DIFF, domPurifyConfig, sanitizeHtmlConfig } from '../src/config.js';

export function runSanitizeHtml(html: string): string {
  return sanitizeHtml(html, sanitizeHtmlConfig());
}

export function runDomPurify(html: string): string {
  return DOMPurify.sanitize(html, domPurifyConfig());
}

export function parseBody(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

export function bodyTagSet(html: string): Set<string> {
  const tags = new Set<string>();
  for (const el of parseBody(html).body.querySelectorAll('*')) {
    tags.add(el.tagName.toLowerCase());
  }
  return tags;
}

export function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

export function tagSetDiff(
  sanitizeTags: Set<string>,
  purifyTags: Set<string>,
): { sanitizeHtmlOnly: string[]; domPurifyOnly: string[] } {
  return {
    sanitizeHtmlOnly: sorted([...sanitizeTags].filter((tag) => !purifyTags.has(tag))),
    domPurifyOnly: sorted([...purifyTags].filter((tag) => !sanitizeTags.has(tag))),
  };
}

export function expectEngineTagSets(sanitizeOut: string, purifyOut: string): void {
  const diff = tagSetDiff(bodyTagSet(sanitizeOut), bodyTagSet(purifyOut));
  expect(diff.sanitizeHtmlOnly).toEqual([...ENGINE_ALLOWED_TAG_DIFF.sanitizeHtmlOnly]);
  expect(diff.domPurifyOnly).toEqual([...ENGINE_ALLOWED_TAG_DIFF.domPurifyOnly]);
}

export function expectDangerGone(html: string): void {
  const lower = html.toLowerCase();
  expect(lower).not.toContain('<script');
  expect(lower).not.toContain('javascript:');
  expect(lower).not.toContain('onclick');
  expect(lower).not.toContain('onerror');
  expect(lower).not.toContain('onload');
  expect(lower).not.toContain('onmouseover');
  expect(html).not.toContain('style=');
  expect(html).not.toMatch(/\sclass=/i);
  expect(lower).not.toContain('<svg');
  expect(lower).not.toContain('<iframe');
  expect(html).not.toMatch(/href=["']data:/i);
}
