import type { CompileContext, Extension as FromMarkdownExtension } from 'mdast-util-from-markdown';
import type { Handle, Options as ToMarkdownExtension } from 'mdast-util-to-markdown';
import { parseEntityToken, renderToken } from './tokens.js';
import { isVitalEntity, type VitalEntity } from './types.js';

function asCompile(ctx: CompileContext): CompileContext {
  return ctx;
}

export function vitalEntityFromMarkdown(): FromMarkdownExtension {
  return {
    enter: {
      vitalEntity: function enterVitalEntity(this: CompileContext, token) {
        const node: VitalEntity = {
          type: 'vitalEntity',
          kind: 'task',
          id: '00000000-0000-4000-8000-000000000000',
        };
        asCompile(this).enter(node, token);
      },
    },
    exit: {
      vitalEntity: function exitVitalEntity(this: CompileContext, token) {
        const ctx = asCompile(this);
        const raw = ctx.sliceSerialize(token);
        const parsed = parseEntityToken(raw);
        const node: unknown = ctx.stack[ctx.stack.length - 1];
        if (parsed && isVitalEntity(node)) {
          node.kind = parsed.kind;
          node.id = parsed.id;
        }
        ctx.exit(token);
      },
    },
  };
}

const handleVitalEntity: Handle = (node) => {
  if (!isVitalEntity(node)) return '';
  return renderToken(node.kind, node.id);
};

export function vitalEntityToMarkdown(): ToMarkdownExtension {
  return {
    handlers: {
      vitalEntity: handleVitalEntity,
    },
  };
}
