import { htmlToArticleDoc } from '@vital/article-doc';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderDoc } from '@/features/inbox/ReaderDoc';
import { openArticleLink } from '@/features/inbox/reader-link';
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

function renderArticle(html: string) {
  const doc = htmlToArticleDoc(html);
  return render(<div className="reader-article">{renderDoc(doc, [])}</div>);
}

afterEach(() => {
  Reflect.deleteProperty(window, '__VITAL_HOST__');
  vi.restoreAllMocks();
});

describe('article external links', () => {
  it('shows a jump icon and leaves command-click to the browser', () => {
    renderArticle('<p>见 <a href="https://example.com/post">原文</a></p>');
    const link = screen.getByRole('link', { name: '原文' });
    expect(link).toHaveAttribute('href', 'https://example.com/post');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.querySelector('.reader-link-icon')).not.toBeNull();
    expect(fireEvent.click(link, { metaKey: true })).toBe(true);
  });

  it('asks the desktop shell to open command-click and a plain click', () => {
    const openExternal = vi.fn();
    Object.defineProperty(window, '__VITAL_HOST__', {
      configurable: true,
      value: desktopHost(openExternal),
    });
    renderArticle('<p><a href="https://example.com/post">原文</a></p>');
    const link = screen.getByRole('link', { name: '原文' });
    expect(fireEvent.click(link, { metaKey: true })).toBe(false);
    fireEvent.click(link);
    expect(openExternal).toHaveBeenCalledTimes(2);
    expect(openExternal).toHaveBeenCalledWith('https://example.com/post');
  });

  it('ignores unsafe hrefs on the desktop shell', () => {
    const openExternal = vi.fn();
    Object.defineProperty(window, '__VITAL_HOST__', {
      configurable: true,
      value: desktopHost(openExternal),
    });
    const preventDefault = vi.fn();
    openArticleLink(
      {
        button: 0,
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        defaultPrevented: false,
        preventDefault,
      },
      'javascript:alert(1)',
    );
    expect(preventDefault).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });
});
