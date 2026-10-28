import { afterEach, describe, expect, it, vi } from 'vitest';
import { openTaskNoteLink, hrefFromLinkClick } from '@/features/todos/notes-link';
import type { VitalHost } from '@/host';

function click(partial: Partial<Parameters<typeof openTaskNoteLink>[0]> = {}) {
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    defaultPrevented: false,
    preventDefault: vi.fn(),
    ...partial,
  };
}

function desktopHost(openExternal: (url: string) => void): VitalHost {
  return {
    kind: 'desktop',
    applyChrome() {},
    showStickyAlert() {},
    listenStickyAlerts: async () => () => undefined,
    closeStickyAlert() {},
    openInMain() {},
    hideMain() {},
    openExternal,
  };
}

afterEach(() => {
  Reflect.deleteProperty(window, '__VITAL_HOST__');
  vi.restoreAllMocks();
});

describe('task note links', () => {
  it('reads the href from the clicked anchor', () => {
    const anchor = document.createElement('a');
    anchor.setAttribute('href', 'https://example.com/post');
    const inner = document.createElement('strong');
    anchor.append(inner);
    expect(hrefFromLinkClick(inner)).toBe('https://example.com/post');
    expect(hrefFromLinkClick(document.createElement('span'))).toBeNull();
  });

  it('leaves a plain click to the editor', () => {
    const event = click();
    expect(openTaskNoteLink(event, 'https://example.com/post')).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('asks the desktop shell to open a command-click', () => {
    const openExternal = vi.fn();
    Object.defineProperty(window, '__VITAL_HOST__', {
      configurable: true,
      value: desktopHost(openExternal),
    });
    const event = click({ metaKey: true });
    expect(openTaskNoteLink(event, ' https://example.com/post ')).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledWith('https://example.com/post');
  });

  it('asks the desktop shell to open a ctrl-click', () => {
    const openExternal = vi.fn();
    Object.defineProperty(window, '__VITAL_HOST__', {
      configurable: true,
      value: desktopHost(openExternal),
    });
    const event = click({ ctrlKey: true });
    expect(openTaskNoteLink(event, 'mailto:a@b.co')).toBe(true);
    expect(openExternal).toHaveBeenCalledWith('mailto:a@b.co');
  });

  it('opens a new browser tab when there is no desktop shell', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const event = click({ metaKey: true });
    expect(openTaskNoteLink(event, 'https://example.com/post')).toBe(true);
    expect(open).toHaveBeenCalledWith('https://example.com/post', '_blank', 'noopener,noreferrer');
  });

  it('ignores unsafe hrefs and alt-clicks', () => {
    const openExternal = vi.fn();
    Object.defineProperty(window, '__VITAL_HOST__', {
      configurable: true,
      value: desktopHost(openExternal),
    });
    const unsafe = click({ metaKey: true });
    expect(openTaskNoteLink(unsafe, 'javascript:alert(1)')).toBe(false);
    const alt = click({ metaKey: true, altKey: true });
    expect(openTaskNoteLink(alt, 'https://example.com/post')).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });
});
