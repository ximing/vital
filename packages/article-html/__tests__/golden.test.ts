import { describe, expect, it } from 'vitest';
import { ARTICLE_ALLOWED_TAGS, ENGINE_URI_DIFF } from '../src/config.js';
import {
  expectDangerGone,
  expectEngineTagSets,
  parseBody,
  runDomPurify,
  runSanitizeHtml,
} from './helpers.js';
import {
  MALICIOUS_HTML,
  PROTOCOL_RELATIVE_HTML,
  RICH_HTML,
  TABLE_HTML,
  VOCABULARY_HTML,
} from './fixtures.js';

function both(html: string): { sanitizeOut: string; purifyOut: string } {
  const sanitizeOut = runSanitizeHtml(html);
  const purifyOut = runDomPurify(html);
  return { sanitizeOut, purifyOut };
}

describe('golden: table', () => {
  it('keeps caption/thead/tbody/tfoot and cell span attrs on both engines', () => {
    const { sanitizeOut, purifyOut } = both(TABLE_HTML);
    for (const html of [sanitizeOut, purifyOut]) {
      const doc = parseBody(html);
      expect(doc.querySelector('table')).not.toBeNull();
      expect(doc.querySelector('caption')?.textContent).toBe('Scores');
      expect(doc.querySelector('thead')).not.toBeNull();
      expect(doc.querySelector('tbody')).not.toBeNull();
      expect(doc.querySelector('tfoot')).not.toBeNull();
      expect(doc.querySelector('th')?.getAttribute('colspan')).toBe('2');
      expect(doc.querySelector('th')?.getAttribute('scope')).toBe('col');
      expect(doc.querySelector('td')?.getAttribute('rowspan')).toBe('2');
      expect(doc.body.textContent).toContain('A');
      expect(doc.body.textContent).toContain('B');
      expect(doc.body.textContent).toContain('C');
    }
    expectEngineTagSets(sanitizeOut, purifyOut);
  });
});

describe('golden: rich article tags', () => {
  it('keeps pre/code, lists, dl, phrasing, and details on both engines', () => {
    const { sanitizeOut, purifyOut } = both(RICH_HTML);
    for (const html of [sanitizeOut, purifyOut]) {
      const doc = parseBody(html);
      expect(doc.querySelector('pre code')?.textContent).toBe('const x = 1;');
      expect(doc.querySelector('blockquote')?.textContent).toBe('quoted');
      expect(doc.querySelector('ul li')?.textContent).toBe('one');
      const ol = doc.querySelector('ol');
      expect(ol?.getAttribute('start')).toBe('3');
      expect(ol?.hasAttribute('reversed')).toBe(true);
      expect(doc.querySelector('ol li')?.getAttribute('value')).toBe('9');
      expect(doc.querySelector('dt')?.textContent).toBe('Term');
      expect(doc.querySelector('dd')?.textContent).toBe('Def');
      expect(doc.querySelector('sub')?.textContent).toBe('2');
      expect(doc.querySelector('sup')?.textContent).toBe('n');
      expect(doc.querySelector('mark')?.textContent).toBe('hit');
      expect(doc.querySelector('kbd')?.textContent).toBe('Ctrl');
      expect(doc.querySelector('del')?.textContent).toBe('old');
      expect(doc.querySelector('ins')?.textContent).toBe('new');
      const details = doc.querySelector('details');
      expect(details).not.toBeNull();
      expect(details?.hasAttribute('open')).toBe(true);
      expect(doc.querySelector('summary')?.textContent).toBe('More');
      expect(doc.querySelector('time')?.getAttribute('datetime')).toBe('2026-01-02');
    }
    expectEngineTagSets(sanitizeOut, purifyOut);
  });
});

describe('golden: malicious', () => {
  it('strips script, javascript URIs, events, style/class, data URI, svg', () => {
    const { sanitizeOut, purifyOut } = both(MALICIOUS_HTML);
    for (const html of [sanitizeOut, purifyOut]) {
      expectDangerGone(html);
      const doc = parseBody(html);
      expect(doc.body.textContent).toContain('safe');
      expect(doc.body.textContent).toContain('hi');
      expect(doc.querySelector('script')).toBeNull();
      expect(doc.querySelector('svg')).toBeNull();
      expect(doc.querySelector('iframe')).toBeNull();
      expect(doc.querySelector('[onclick]')).toBeNull();
      expect(doc.querySelector('[style]')).toBeNull();
      expect(doc.querySelector('[class]')).toBeNull();
    }
    expectEngineTagSets(sanitizeOut, purifyOut);
  });
});

describe('golden: full vocabulary', () => {
  it('both engines keep every SSOT tag', () => {
    const { sanitizeOut, purifyOut } = both(VOCABULARY_HTML);
    for (const html of [sanitizeOut, purifyOut]) {
      const doc = parseBody(html);
      for (const tag of ARTICLE_ALLOWED_TAGS) {
        expect(doc.querySelector(tag), `missing <${tag}>`).not.toBeNull();
      }
      expect(doc.querySelector('a')?.getAttribute('href')).toBe('https://e.test/a');
      expect(doc.querySelector('img')?.getAttribute('src')).toContain('https://e.test/');
      expect(doc.querySelector('video')?.getAttribute('src')).toBe('https://e.test/a.mp4');
      expect(doc.querySelector('video source')?.getAttribute('type')).toBe('video/mp4');
    }
    expectEngineTagSets(sanitizeOut, purifyOut);
  });
});

describe('golden: declared URI engine gaps', () => {
  it('matches ENGINE_URI_DIFF for //host URLs', () => {
    const { sanitizeOut, purifyOut } = both(PROTOCOL_RELATIVE_HTML);
    expect(ENGINE_URI_DIFF.protocolRelative.sanitizeHtml).toBe('strip');
    expect(ENGINE_URI_DIFF.protocolRelative.domPurify).toBe('allow');
    expect(sanitizeOut).not.toContain('//evil.test');
    expect(purifyOut).toContain('//evil.test');
  });

  it('matches ENGINE_URI_DIFF for data: on img', () => {
    const { sanitizeOut, purifyOut } = both(
      '<img src="data:image/gif;base64,xx" alt="d"><a href="data:text/html,y">y</a>',
    );
    expect(ENGINE_URI_DIFF.dataUriOnMedia.sanitizeHtml).toBe('strip');
    expect(ENGINE_URI_DIFF.dataUriOnMedia.domPurify).toBe('allow');
    expect(sanitizeOut).not.toMatch(/\ssrc=["']data:/i);
    expect(purifyOut).toMatch(/\ssrc=["']data:/i);
    expect(sanitizeOut).not.toMatch(/href=["']data:/i);
    expect(purifyOut).not.toMatch(/href=["']data:/i);
  });
});
