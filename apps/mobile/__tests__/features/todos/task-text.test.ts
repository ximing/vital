import { describe, expect, it } from 'vitest';
import {
  applyServerText,
  mergeLoadedText,
  proposalDraft,
  proposalSubtasks,
  textPatch,
  titleIsDirty,
} from '../../../src/features/todos/task-text';

const clean = { title: '周报', notes: '旧备注', titleDirty: false, notesDirty: false };

describe('task text draft', () => {
  it('does not send an unchanged or empty title', () => {
    expect(textPatch({ title: '周报', notes: '' }, '周报', '')).toBeNull();
    expect(textPatch({ title: '周报', notes: '' }, '   ', '')).toBeNull();
    expect(titleIsDirty('周报', '   ')).toBe(false);
  });

  it('sends a cleared note and a trimmed title', () => {
    expect(textPatch({ title: '周报', notes: '旧' }, '  新标题  ', '')).toEqual({
      title: '新标题',
      notes: '',
    });
  });

  it('keeps unsaved notes when another field patch comes back', () => {
    const next = applyServerText(
      { ...clean, notes: '正在写', notesDirty: true },
      { title: '周报', notes: '旧备注' },
      {},
    );
    expect(next.notes).toBe('正在写');
    expect(next.notesDirty).toBe(true);
    expect(next.title).toBe('周报');
  });

  it('keeps keystrokes that landed after the note request was sent', () => {
    const next = applyServerText(
      { ...clean, notes: '正在写更多', notesDirty: true },
      { title: '周报', notes: '正在写' },
      { notes: '正在写' },
    );
    expect(next.notes).toBe('正在写更多');
    expect(next.notesDirty).toBe(true);
  });

  it('accepts the server text once it matches the draft', () => {
    const next = applyServerText(
      { ...clean, title: '新标题 ', titleDirty: true, notes: '新备注', notesDirty: true },
      { title: '新标题', notes: '新备注' },
      { title: '新标题', notes: '新备注' },
    );
    expect(next).toEqual({
      title: '新标题',
      notes: '新备注',
      titleDirty: false,
      notesDirty: false,
    });
  });

  it('drops a reload that is older than the open draft', () => {
    const next = mergeLoadedText(
      { title: '本地', notes: '本地备注', titleDirty: true, notesDirty: true },
      { title: '服务器', notes: '服务器备注' },
    );
    expect(next.title).toBe('本地');
    expect(next.notes).toBe('本地备注');
  });

  it('takes the server text when the draft matches it', () => {
    const next = mergeLoadedText(
      { title: '周报', notes: '旧备注', titleDirty: true, notesDirty: true },
      { title: '周报', notes: '旧备注' },
    );
    expect(next.titleDirty).toBe(false);
    expect(next.notesDirty).toBe(false);
  });

  it('reads draft and decompose payloads', () => {
    expect(proposalDraft({ draft: '先写大纲' })).toBe('先写大纲');
    expect(
      proposalSubtasks({
        subtasks: [
          { title: '列清单', estimateMinutes: 15 },
          { title: '  ' },
          { nope: true },
        ],
      }),
    ).toEqual([{ title: '列清单', estimateMinutes: 15 }]);
  });
});
