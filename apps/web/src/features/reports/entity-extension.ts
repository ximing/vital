import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ENTITY_CHIP_TYPE, isEntityKind } from '@vital/markdown';
import { EntityChipView } from './EntityChip';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    vitalEntity: {
      insertVitalEntity: (attrs: { kind: 'task' | 'inbox'; id: string }) => ReturnType;
    };
  }
}

export const VitalEntity = Node.create({
  name: ENTITY_CHIP_TYPE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      kind: {
        default: 'task',
        parseHTML: (el: HTMLElement) => {
          const value = el.getAttribute('data-kind');
          return value && isEntityKind(value) ? value : 'task';
        },
      },
      id: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-id') ?? '',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-vital-entity]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-vital-entity': '' }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EntityChipView, { as: 'span' });
  },

  addCommands() {
    return {
      insertVitalEntity:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: ENTITY_CHIP_TYPE, attrs }),
    };
  },
});
