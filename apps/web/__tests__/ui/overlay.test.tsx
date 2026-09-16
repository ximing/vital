import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ConfirmDialog } from '@/ui/confirm-dialog';

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

    await user.click(container.querySelector('.fixed.inset-0') as HTMLElement);
    expect(screen.getByRole('dialog', { name: '关闭线程' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.getByText('closed')).toBeInTheDocument();
  });
});
