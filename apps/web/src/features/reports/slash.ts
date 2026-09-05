import type { Editor } from '@tiptap/core';
import { ENTITY_CHIP_TYPE, type EntityKind } from '@vital/markdown';
import { slashFromText, type SlashQuery } from './model';

export function slashFromEditor(editor: Editor): SlashQuery | null {
  const { $from, empty } = editor.state.selection;
  if (!empty) return null;
  const text = $from.parent.textBetween(0, $from.parentOffset, '\n', '\0');
  const found = slashFromText(text, text.length);
  if (!found) return null;
  const start = $from.start();
  return { query: found.query, from: start + found.from, to: start + found.to };
}

export function insertChip(
  editor: Editor,
  slash: SlashQuery | null,
  kind: EntityKind,
  id: string,
): void {
  const chain = editor.chain().focus();
  if (slash) chain.deleteRange({ from: slash.from, to: slash.to });
  chain.insertContent({ type: ENTITY_CHIP_TYPE, attrs: { kind, id } }).run();
}
