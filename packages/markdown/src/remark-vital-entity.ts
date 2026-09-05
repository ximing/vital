import type { Plugin } from 'unified';
import { vitalEntityFromMarkdown, vitalEntityToMarkdown } from './mdast-vital-entity.js';
import { vitalEntitySyntax } from './micromark-vital-entity.js';

function addExtension(data: Record<string, unknown>, field: string, value: unknown): void {
  const existing = data[field];
  if (Array.isArray(existing)) {
    existing.push(value);
    return;
  }
  data[field] = [value];
}

/** remark plugin: micromark + mdast `vitalEntity` `{ kind, id }`. */
export const remarkVitalEntity: Plugin = function remarkVitalEntity() {
  const data = this.data() as Record<string, unknown>;
  addExtension(data, 'micromarkExtensions', vitalEntitySyntax());
  addExtension(data, 'fromMarkdownExtensions', vitalEntityFromMarkdown());
  addExtension(data, 'toMarkdownExtensions', vitalEntityToMarkdown());
};
