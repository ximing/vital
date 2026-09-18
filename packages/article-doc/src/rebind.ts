import { imageSrcKeys } from './image-src.js';
import { attachmentIdOfUploadRef, uploadRefOf } from './refs.js';
import type { ArticleBlockNode, ArticleDoc, DocAssetRef } from './types.js';

/**
 * Bind doc media nodes to uploaded attachments: any image/video/poster src
 * matching an asset's original page URL (imageSrcKeys) is rewritten to the
 * stable `/api/v1/uploads/<attachmentId>` ref. Already-bound refs are kept.
 * Returns the doc unchanged (same reference) when nothing matched.
 */
export function rebindDocMedia(doc: ArticleDoc, assets: readonly DocAssetRef[]): ArticleDoc {
  if (assets.length === 0 || doc.content.length === 0) return doc;
  const bySrc = new Map<string, string>();
  for (const asset of assets) {
    for (const key of imageSrcKeys(asset.originalSrc)) {
      if (!bySrc.has(key)) bySrc.set(key, asset.attachmentId);
    }
  }
  let changed = false as boolean;
  const rebindSrc = (src: string): string => {
    if (attachmentIdOfUploadRef(src) !== null) return src;
    for (const key of imageSrcKeys(src)) {
      const hit = bySrc.get(key);
      if (hit !== undefined) {
        changed = true;
        return uploadRefOf(hit);
      }
    }
    return src;
  };
  const walk = (blocks: ArticleBlockNode[]): ArticleBlockNode[] =>
    blocks.map((block) => {
      switch (block.type) {
        case 'image':
          return { ...block, attrs: { ...block.attrs, src: rebindSrc(block.attrs.src) } };
        case 'video': {
          const attrs = { ...block.attrs, src: rebindSrc(block.attrs.src) };
          if (attrs.poster !== undefined) attrs.poster = rebindSrc(attrs.poster);
          return { ...block, attrs };
        }
        case 'blockquote':
          return { ...block, content: walk(block.content) };
        case 'bulletList':
        case 'orderedList':
          return {
            ...block,
            content: block.content.map((item) => ({
              ...item,
              content: walk(item.content),
            })),
          };
        case 'table':
          return {
            ...block,
            content: block.content.map((row) => ({
              ...row,
              content: row.content.map((cell) => ({ ...cell, content: walk(cell.content) })),
            })),
          };
        default:
          return block;
      }
    });
  const content = walk(doc.content);
  return changed ? { type: 'doc', content } : doc;
}
