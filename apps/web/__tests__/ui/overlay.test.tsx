import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { PromptDialog } from '@/ui/prompt-dialog';

function Host() {
  const [open, setOpen] = useState(true);
  if (!open) return <div>closed</div>;
  return (
    <ConfirmDialog
      title="关闭线程"
      body="确认关闭"
      confirmLabel="关闭"
      cancelLabel="取消"
      onConfirm={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    />
  );
}

describe('ConfirmDialog', () => {
  it('closes on Escape and does not close on scrim click', async () => {
    const user = userEvent.setup();
    const { container } = render(<Host />);
    expect(screen.getByRole('dialog', { name: '关闭线程' })).toBeInTheDocument();
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await user.click(document.querySelector('.fixed.inset-0') as HTMLElement);
    expect(screen.getByRole('dialog', { name: '关闭线程' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.getByText('closed')).toBeInTheDocument();
  });
});

function PromptHost() {
  const [result, setResult] = useState<string | null>(null);
  if (result !== null) return <div>got {result}</div>;
  return (
    <PromptDialog
      title="链接地址"
      defaultValue="https://"
      confirmLabel="确定"
      cancelLabel="取消"
      onConfirm={setResult}
      onCancel={() => setResult('')}
    />
  );
}

describe('PromptDialog', () => {
  it('keeps the default value, ignores scrim click, and confirms the typed url', async () => {
    const user = userEvent.setup();
    const { container } = render(<PromptHost />);
    const input = screen.getByRole('textbox', { name: '链接地址' });
    expect(input).toHaveValue('https://');
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await user.click(document.querySelector('.fixed.inset-0') as HTMLElement);
    expect(screen.getByRole('dialog', { name: '链接地址' })).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, 'https://example.com');
    await user.click(screen.getByRole('button', { name: '确定' }));
    expect(screen.getByText('got https://example.com')).toBeInTheDocument();
  });

  it('closes on Escape without confirming', async () => {
    const user = userEvent.setup();
    render(<PromptHost />);
    await user.keyboard('{Escape}');
    expect(screen.getByText('got')).toBeInTheDocument();
  });
});
