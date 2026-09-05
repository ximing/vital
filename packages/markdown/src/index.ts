export {
  ENTITY_TOKEN_SOURCE,
  entityTokenGlobalRe,
  extractTokens,
  normalizeTrailingNewlines,
  parseEntityToken,
  renderToken,
  splitForRender,
} from './tokens.js';
export { ensureFillHeadings, hasH2, insertTokensIdempotent } from './insert.js';
export {
  parseMarkdownToMdast,
  parseMarkdownToPmJSON,
  serializeMdastToMarkdown,
  serializePmJSONToMarkdown,
} from './pipeline.js';
export { mdastToPmJSON, pmJSONToMdast } from './pmjson.js';
export { remarkVitalEntity } from './remark-vital-entity.js';
export {
  isEntityKind,
  isVitalEntity,
  type EntityKind,
  type EntityToken,
  type FillHeadings,
  type MdastRoot,
  type PmMark,
  type PmNode,
  type RenderPart,
  type VitalEntity,
} from './types.js';

/** TipTap/ProseMirror atom name. Serialized form is exactly `[[kind:id]]`. */
export const ENTITY_CHIP_TYPE = 'vitalEntity' as const;
