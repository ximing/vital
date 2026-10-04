import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { placeTip, resetTipWarmth, Tip, TIP_OPEN_DELAY_MS } from '@/ui/tip';

afterEach(() => {
  resetTipWarmth();
  vi.useRealTimers();
});

describe('placeTip', () => {
  it('flips to the opposite side when the preferred side does not fit', () => {
    const anchor = new DOMRect(4, 100, 20, 20);
    const tip = new DOMRect(0, 0, 80, 24);
    const pos = placeTip(anchor, tip, 'left');
    expect(pos.left).toBeGreaterThan(anchor.right);
  });
});

describe('Tip', () => {
  it('waits a short hover delay, then opens', () => {
    vi.useFakeTimers();
    render(
      <Tip label="复制链接">
        <button type="button">copy</button>
      </Tip>,
    );
    const button = screen.getByRole('button', { name: 'copy' });
    expect(button).not.toHaveAttribute('title');

    act(() => {
      fireEvent.mouseOver(button);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(TIP_OPEN_DELAY_MS - 1);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('复制链接');
    expect(button).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id);
  });

  it('opens the next tip immediately while the pointer is still warm', () => {
    vi.useFakeTimers();
    render(
      <div>
        <Tip label="今天">
          <button type="button">today</button>
        </Tip>
        <Tip label="待办">
          <button type="button">todos</button>
        </Tip>
      </div>,
    );
    const today = screen.getByRole('button', { name: 'today' });
    const todos = screen.getByRole('button', { name: 'todos' });

    act(() => {
      fireEvent.mouseOver(today);
      vi.advanceTimersByTime(TIP_OPEN_DELAY_MS);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('今天');

    act(() => {
      fireEvent.mouseOut(today);
      fireEvent.mouseOver(todos);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('待办');
  });

  it('does not open for an empty label or a touch pointer', () => {
    vi.useFakeTimers();
    render(
      <div>
        <Tip label="">
          <button type="button">plain</button>
        </Tip>
        <Tip label="搜索">
          <button type="button">search</button>
        </Tip>
      </div>,
    );
    act(() => {
      fireEvent.mouseOver(screen.getByRole('button', { name: 'plain' }));
      vi.advanceTimersByTime(TIP_OPEN_DELAY_MS);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    const search = screen.getByRole('button', { name: 'search' });
    act(() => {
      fireEvent.touchStart(search);
      fireEvent.mouseOver(search);
      vi.advanceTimersByTime(TIP_OPEN_DELAY_MS);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('still opens on a disabled control', () => {
    vi.useFakeTimers();
    render(
      <Tip label="抓取">
        <button type="button" disabled>
          extract
        </button>
      </Tip>,
    );
    const button = screen.getByRole('button', { name: 'extract' });
    act(() => {
      if (button.parentElement) fireEvent.mouseOver(button.parentElement);
      vi.advanceTimersByTime(TIP_OPEN_DELAY_MS);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('抓取');
  });

  it('opens immediately for keyboard focus and closes on blur', () => {
    const original = HTMLElement.prototype.matches;
    HTMLElement.prototype.matches = function matches(selector: string) {
      if (selector === ':focus-visible') return true;
      return original.call(this, selector);
    };
    render(
      <Tip label="设置">
        <button type="button">settings</button>
      </Tip>,
    );
    const button = screen.getByRole('button', { name: 'settings' });
    act(() => {
      button.focus();
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('设置');
    act(() => {
      button.blur();
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    HTMLElement.prototype.matches = original;
  });

  it('hides when the label is cleared', () => {
    vi.useFakeTimers();
    function Host() {
      const [label, setLabel] = useState('已复制');
      return (
        <div>
          <Tip label={label}>
            <button type="button" onClick={() => setLabel('')}>
              copy
            </button>
          </Tip>
        </div>
      );
    }
    render(<Host />);
    const button = screen.getByRole('button', { name: 'copy' });
    act(() => {
      fireEvent.mouseOver(button);
      vi.advanceTimersByTime(TIP_OPEN_DELAY_MS);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('已复制');
    act(() => {
      button.click();
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
