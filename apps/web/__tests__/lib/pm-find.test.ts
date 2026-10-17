import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { findInPmDoc, indexAtOrAfter, replaceMatchesInTransaction } from '@/lib/pm-find';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
    hardBreak: { group: 'inline', inline: true },
    image: { group: 'inline', inline: true, atom: true },
  },
  marks: {
    bold: {},
  },
});

function stateWith(doc: ReturnType<Schema['node']>): EditorState {
  return EditorState.create({ schema, doc });
}

describe('findInPmDoc', () => {
  it('matches a keyword across inline marks and replaces it', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('Hello '),
        schema.text('keyword', [schema.mark('bold')]),
      ]),
    ]);
    const state = stateWith(doc);
    const matches = findInPmDoc(state.doc, 'KEYWORD', false);
    expect(matches).toHaveLength(1);
    const hit = matches[0];
    expect(hit).toBeDefined();
    if (!hit) return;
    expect(state.doc.textBetween(hit.from, hit.to)).toBe('keyword');
    const next = state.apply(replaceMatchesInTransaction(state.tr, matches, '词'));
    expect(next.doc.textContent).toBe('Hello 词');
    expect(indexAtOrAfter(findInPmDoc(next.doc, 'keyword', false), hit.from + '词'.length)).toBe(0);
  });

  it('does not match across paragraphs or through an atom', () => {
    const split = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('hel')]),
      schema.node('paragraph', null, [schema.text('lo')]),
    ]);
    expect(findInPmDoc(split, 'hello', true)).toEqual([]);

    const atom = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('ab'), schema.node('image'), schema.text('cd')]),
    ]);
    expect(findInPmDoc(atom, 'bc', true)).toEqual([]);
    expect(findInPmDoc(atom, 'ab', true)).toHaveLength(1);
  });

  it('replaces every match from the end so earlier positions stay valid', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('aa aa')])]);
    const state = stateWith(doc);
    const matches = findInPmDoc(state.doc, 'aa', true);
    expect(matches).toHaveLength(2);
    const next = state.apply(replaceMatchesInTransaction(state.tr, matches, 'b'));
    expect(next.doc.textContent).toBe('b b');
  });
});
