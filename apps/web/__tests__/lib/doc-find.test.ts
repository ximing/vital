import { describe, expect, it } from 'vitest';
import { docFindRootFor, isDocFindChord } from '@/lib/doc-find';

describe('doc find chord', () => {
  it('is ⌘F or Ctrl+F without shift or alt', () => {
    expect(
      isDocFindChord({ key: 'f', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }),
    ).toBe(true);
    expect(
      isDocFindChord({ key: 'F', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }),
    ).toBe(true);
    expect(
      isDocFindChord({ key: 'f', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true }),
    ).toBe(false);
    expect(
      isDocFindChord({ key: 'k', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }),
    ).toBe(false);
  });

  it('prefers the focused document, then the page document', () => {
    document.body.innerHTML =
      '<main data-doc-find="page"><p id="body">正文</p><input id="tag" /><div data-testid="doc-find"><input id="find" /></div><div id="editor" contenteditable="true"></div></main><input id="other" /><div data-doc-find="notes" id="notes"></div>';
    expect(docFindRootFor(document.getElementById('body'))?.tagName).toBe('MAIN');
    expect(docFindRootFor(document.getElementById('editor'))?.tagName).toBe('MAIN');
    expect(docFindRootFor(document.getElementById('find'))?.tagName).toBe('MAIN');
    expect(docFindRootFor(document.getElementById('tag'))).toBeNull();
    expect(docFindRootFor(document.getElementById('notes'))?.id).toBe('notes');
    expect(docFindRootFor(document.getElementById('other'))).toBeNull();
    expect(docFindRootFor(document.body)?.getAttribute('data-doc-find')).toBe('page');
    document.body.innerHTML = '';
  });
});
