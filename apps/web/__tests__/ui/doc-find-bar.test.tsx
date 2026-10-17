import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DocFindBar } from '@/ui/doc-find-bar';

function bar(overrides: Partial<Parameters<typeof DocFindBar>[0]> = {}) {
  return {
    query: '词',
    replacement: '',
    matchCase: false,
    index: 0,
    count: 2,
    canReplace: true,
    onQuery: vi.fn(),
    onReplacement: vi.fn(),
    onMatchCase: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onReplace: vi.fn(),
    onReplaceAll: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('DocFindBar', () => {
  it('walks matches and replaces the current keyword', async () => {
    const user = userEvent.setup();
    const props = bar();
    render(<DocFindBar {...props} />);
    expect(screen.getByRole('search', { name: '文档内查找' })).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '下一处' }));
    expect(props.onNext).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: '替换' }));
    expect(props.onReplace).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: '全部替换' }));
    expect(props.onReplaceAll).toHaveBeenCalledOnce();
  });

  it('reports no matches and keeps replace idle', () => {
    render(<DocFindBar {...bar({ count: 0 })} />);
    expect(screen.getByText('无匹配')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '替换' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '全部替换' })).toBeDisabled();
  });

  it('sends the find field on Enter and the previous match on Shift+Enter', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const onPrev = vi.fn();
    render(<DocFindBar {...bar({ query: '', onNext, onPrev })} />);
    const find = screen.getByRole('textbox', { name: '查找' });
    await user.type(find, '甲{Enter}');
    expect(onNext).toHaveBeenCalled();
    onNext.mockClear();
    await user.type(find, '{Shift>}{Enter}{/Shift}');
    expect(onPrev).toHaveBeenCalled();
  });
});
