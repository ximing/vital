/**
 * Article HTML allow-lists. Web `purify.ts` is the SSOT for tags/attrs/URI;
 * sanitize-html attribute *placement* follows the server per-tag map so we
 * do not loosen img/a/video/source/td/th by copying the global attr array.
 */

export const ARTICLE_ALLOWED_TAGS = [
  'a',
  'p',
  'br',
  'span',
  'div',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'pre',
  'code',
  'img',
  'figure',
  'figcaption',
  'hr',
  'video',
  'source',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
  'colgroup',
  'col',
  'dl',
  'dt',
  'dd',
  'sup',
  'sub',
  'mark',
  'kbd',
  'abbr',
  'del',
  'ins',
  'q',
  'cite',
  'time',
  'details',
  'summary',
  'picture',
  'small',
] as const;

export type ArticleAllowedTag = (typeof ARTICLE_ALLOWED_TAGS)[number];

export const ARTICLE_ALLOWED_ATTR = [
  'href',
  'title',
  'rel',
  'src',
  'alt',
  'width',
  'height',
  'poster',
  'controls',
  'playsinline',
  'type',
  'colspan',
  'rowspan',
  'scope',
  'start',
  'reversed',
  'value',
  'datetime',
  'open',
] as const;

export type ArticleAllowedAttr = (typeof ARTICLE_ALLOWED_ATTR)[number];

/** http(s)/mailto plus relative paths; never javascript: or data:. */
export const ARTICLE_ALLOWED_URI_REGEXP =
  /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;

/**
 * Per-tag attrs for sanitize-html. Same names as ARTICLE_ALLOWED_ATTR, but
 * placed only on the tags the server already allowed — not globally.
 */
export const SANITIZE_HTML_ALLOWED_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  img: ['src', 'alt', 'title', 'width', 'height'],
  a: ['href', 'title', 'rel'],
  video: ['src', 'poster', 'controls', 'playsinline', 'width', 'height'],
  source: ['src', 'type'],
  table: ['colspan', 'rowspan', 'scope'],
  td: ['colspan', 'rowspan', 'scope'],
  th: ['colspan', 'rowspan', 'scope'],
  ol: ['start', 'reversed'],
  li: ['value'],
  time: ['datetime'],
  details: ['open'],
};

/**
 * Tags in sanitize-html library defaults that article HTML must not inherit.
 * Spreading `defaults.allowedTags` would re-open WeChat `section` wrappers
 * and other chrome the SSOT dropped.
 */
export const SANITIZE_HTML_DEFAULT_TAGS_NOT_IN_SSOT = [
  'address',
  'article',
  'aside',
  'footer',
  'header',
  'hgroup',
  'main',
  'nav',
  'section',
  'menu',
  'bdi',
  'bdo',
  'data',
  'dfn',
  'rb',
  'rp',
  'rt',
  'rtc',
  'ruby',
  'samp',
  'var',
  'wbr',
] as const;

/** Tags the SSOT adds on top of sanitize-html library defaults. */
export const ARTICLE_TAGS_BEYOND_SANITIZE_HTML_DEFAULTS = [
  'img',
  'video',
  'source',
  'details',
  'summary',
  'del',
  'ins',
  'picture',
] as const;

/**
 * Config-level allow-list diff between the two engine adapters.
 * Both are wired to ARTICLE_ALLOWED_TAGS, so this is empty by design.
 * Golden tests assert runtime output tag-set diffs equal these lists.
 */
export const ENGINE_ALLOWED_TAG_DIFF = {
  sanitizeHtmlOnly: [] as const,
  domPurifyOnly: [] as const,
};

/**
 * URI gaps that config cannot close without changing web's URI regexp or
 * wrapping DOMPurify (this package is config-only).
 *
 * - protocol-relative (`//host/path`): sanitize-html rejects
 *   (`allowProtocolRelative: false`). DOMPurify's ALLOWED_URI_REGEXP
 *   (copied from web) allows them because they start with `/`.
 * - `data:` on img/audio/video/source: DOMPurify hard-allows these via an
 *   internal DATA_URI_TAGS set; `ADD_DATA_URI_TAGS` only extends it.
 *   sanitize-html strips `data:` (not in allowedSchemes).
 */
export const ENGINE_URI_DIFF = {
  protocolRelative: {
    sanitizeHtml: 'strip',
    domPurify: 'allow',
  },
  dataUriOnMedia: {
    sanitizeHtml: 'strip',
    domPurify: 'allow',
  },
} as const;

export interface SanitizeHtmlConfig {
  allowedTags: string[];
  allowedAttributes: Record<string, string[]>;
  allowedSchemes: string[];
  allowedSchemesByTag: Record<string, string[]>;
  allowProtocolRelative: boolean;
}

export interface DomPurifyConfig {
  ALLOWED_TAGS: string[];
  ALLOWED_ATTR: string[];
  ALLOW_DATA_ATTR: false;
  ALLOWED_URI_REGEXP: RegExp;
}

function copyAttrMap(map: Readonly<Record<string, readonly string[]>>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [tag, attrs] of Object.entries(map)) {
    out[tag] = [...attrs];
  }
  return out;
}

export function sanitizeHtmlConfig(): SanitizeHtmlConfig {
  return {
    allowedTags: [...ARTICLE_ALLOWED_TAGS],
    allowedAttributes: copyAttrMap(SANITIZE_HTML_ALLOWED_ATTRIBUTES),
    allowedSchemes: ['http', 'https'],
    allowedSchemesByTag: {
      a: ['http', 'https', 'mailto'],
    },
    allowProtocolRelative: false,
  };
}

export function domPurifyConfig(): DomPurifyConfig {
  return {
    ALLOWED_TAGS: [...ARTICLE_ALLOWED_TAGS],
    ALLOWED_ATTR: [...ARTICLE_ALLOWED_ATTR],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: ARTICLE_ALLOWED_URI_REGEXP,
  };
}
