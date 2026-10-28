import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotesEditor } from '@/features/todos/NotesEditor';
import type { VitalHost } from '@/host';

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

describe('NotesEditor link clicks', () => {
  it('opens a command-clicked note link in the system browser on the desktop shell', async () => {
    const openExternal = vi.fn();
    Object.defineProperty(window, '__VITAL_HOST__', {
      configurable: true,
      value: desktopHost(openExternal),
    });
    render(<NotesEditor value="见 [原文](https://example.com/post)" onChange={() => undefined} />);
    const link = await screen.findByRole('link', { name: '原文' });
    fireEvent.click(link, { metaKey: true });
    expect(openExternal).toHaveBeenCalledWith('https://example.com/post');
  });

  it('does not open a note link on a plain click', async () => {
    const openExternal = vi.fn();
    Object.defineProperty(window, '__VITAL_HOST__', {
      configurable: true,
      value: desktopHost(openExternal),
    });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<NotesEditor value="见 [原文](https://example.com/post)" onChange={() => undefined} />);
    const link = await screen.findByRole('link', { name: '原文' });
    fireEvent.click(link);
    expect(openExternal).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});
