/**
 * Article doc — the single body format for inbox articles.
 * ProseMirror-shaped JSON; node names align with @vital/markdown's pmjson.ts
 * so markdown interop stays possible. `image`/`video` are block atom nodes.
 */

export type ArticleMark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'underline' }
  | { type: 'strike' }
  | { type: 'code' }
  | { type: 'subscript' }
  | { type: 'superscript' }
  | { type: 'highlight' }
  | { type: 'link'; attrs: { href: string; title?: string } };

export type ArticleTextNode = {
  type: 'text';
  text: string;
  marks?: ArticleMark[];
};

export type ArticleHardBreak = { type: 'hardBreak' };

export type ArticleInlineNode = ArticleTextNode | ArticleHardBreak;

export type ArticleImageNode = {
  type: 'image';
  attrs: {
    /** `/api/v1/uploads/<attachmentId>` ref or http(s) URL. */
    src: string;
    alt?: string;
    width?: number;
    height?: number;
  };
};

export type ArticleVideoNode = {
  type: 'video';
  attrs: {
    /** `/api/v1/uploads/<attachmentId>` ref or http(s) URL. */
    src: string;
    poster?: string;
    mime?: string;
  };
};

export type ArticleBlockNode =
  | { type: 'paragraph'; content: ArticleInlineNode[] }
  | { type: 'heading'; attrs: { level: number }; content: ArticleInlineNode[] }
  | { type: 'blockquote'; content: ArticleBlockNode[] }
  | { type: 'codeBlock'; attrs?: { language?: string }; content: ArticleTextNode[] }
  | { type: 'bulletList'; content: ArticleListItemNode[] }
  | { type: 'orderedList'; attrs?: { start?: number }; content: ArticleListItemNode[] }
  | { type: 'horizontalRule' }
  | { type: 'table'; content: ArticleTableRowNode[] }
  | ArticleImageNode
  | ArticleVideoNode;

export type ArticleListItemNode = { type: 'listItem'; content: ArticleBlockNode[] };

export type ArticleTableRowNode = {
  type: 'tableRow';
  content: Array<{ type: 'tableHeader' | 'tableCell'; content: ArticleBlockNode[] }>;
};

export type ArticleDoc = {
  type: 'doc';
  content: ArticleBlockNode[];
};

/** Minimal asset shape needed for media rebinding / URL resolution. */
export interface DocAssetRef {
  attachmentId: string;
  originalSrc: string;
}

export interface DocAssetUrl {
  attachmentId: string;
  url?: string;
}

export const EMPTY_ARTICLE_DOC: ArticleDoc = { type: 'doc', content: [] };
