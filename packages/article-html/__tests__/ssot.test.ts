import sanitizeHtml from 'sanitize-html';
import { describe, expect, it } from 'vitest';
import {
  ARTICLE_ALLOWED_ATTR,
  ARTICLE_ALLOWED_TAGS,
  ARTICLE_TAGS_BEYOND_SANITIZE_HTML_DEFAULTS,
  ENGINE_ALLOWED_TAG_DIFF,
  SANITIZE_HTML_ALLOWED_ATTRIBUTES,
  SANITIZE_HTML_DEFAULT_TAGS_NOT_IN_SSOT,
  domPurifyConfig,
  sanitizeHtmlConfig,
} from '../src/config.js';
import { sorted } from './helpers.js';

function setOf(values: readonly string[]): Set<string> {
  return new Set(values);
}

function onlyIn(a: Set<string>, b: Set<string>): string[] {
  return sorted([...a].filter((value) => !b.has(value)));
}

describe('SSOT guard', () => {
  it('ARTICLE_ALLOWED_TAGS matches both engine configs except ENGINE_ALLOWED_TAG_DIFF', () => {
    const ssot = setOf(ARTICLE_ALLOWED_TAGS);
    const sanitizeTags = setOf(sanitizeHtmlConfig().allowedTags);
    const purifyTags = setOf(domPurifyConfig().ALLOWED_TAGS);

    expect(onlyIn(sanitizeTags, ssot)).toEqual([...ENGINE_ALLOWED_TAG_DIFF.sanitizeHtmlOnly]);
    expect(onlyIn(ssot, sanitizeTags)).toEqual([]);
    expect(onlyIn(purifyTags, ssot)).toEqual([...ENGINE_ALLOWED_TAG_DIFF.domPurifyOnly]);
    expect(onlyIn(ssot, purifyTags)).toEqual([]);
  });

  it('ARTICLE_ALLOWED_ATTR matches DOMPurify ALLOWED_ATTR and the sanitize-html attr name set', () => {
    const ssot = setOf(ARTICLE_ALLOWED_ATTR);
    expect(sorted(domPurifyConfig().ALLOWED_ATTR)).toEqual(sorted(ssot));
    const perTagNames = new Set<string>();
    for (const attrs of Object.values(SANITIZE_HTML_ALLOWED_ATTRIBUTES)) {
      for (const attr of attrs) perTagNames.add(attr);
    }
    expect(sorted(perTagNames)).toEqual(sorted(ssot));
  });

  it('sanitize-html default tags not in SSOT are exactly the named exclusion list', () => {
    const ssot = setOf(ARTICLE_ALLOWED_TAGS);
    const defaults = setOf(sanitizeHtml.defaults.allowedTags);
    expect(onlyIn(defaults, ssot)).toEqual(sorted(SANITIZE_HTML_DEFAULT_TAGS_NOT_IN_SSOT));
    expect(onlyIn(ssot, defaults)).toEqual(sorted(ARTICLE_TAGS_BEYOND_SANITIZE_HTML_DEFAULTS));
  });

  it('sanitizeHtmlConfig does not inherit excluded default tags', () => {
    const allowed = setOf(sanitizeHtmlConfig().allowedTags);
    for (const tag of SANITIZE_HTML_DEFAULT_TAGS_NOT_IN_SSOT) {
      expect(allowed.has(tag), `leaked default <${tag}>`).toBe(false);
    }
  });

  it('per-tag attr map overrides every sanitize-html default attr key', () => {
    for (const key of Object.keys(sanitizeHtml.defaults.allowedAttributes)) {
      expect(
        SANITIZE_HTML_ALLOWED_ATTRIBUTES[key],
        `must override default attrs for <${key}>`,
      ).toBeDefined();
    }
  });

  it('engine configs are clones (mutating the return value does not change SSOT)', () => {
    const a = sanitizeHtmlConfig();
    a.allowedTags.push('script');
    a.allowedAttributes.img?.push('onerror');
    expect(sanitizeHtmlConfig().allowedTags).not.toContain('script');
    expect(sanitizeHtmlConfig().allowedAttributes.img).not.toContain('onerror');

    const b = domPurifyConfig();
    b.ALLOWED_TAGS.push('script');
    b.ALLOWED_ATTR.push('onclick');
    expect(domPurifyConfig().ALLOWED_TAGS).not.toContain('script');
    expect(domPurifyConfig().ALLOWED_ATTR).not.toContain('onclick');
  });
});
