import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@/copy';
import { TimeField } from '../../src/ui/time-field';

describe('TimeField', () => {
  it('uses the shared field and popover treatment for a time value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TimeField label="提醒时间" value="09:00" onChange={onChange} />);

    const trigger = screen.getByRole('button', { name: '提醒时间' });
    expect(trigger).toHaveClass('h-[var(--field-h)]', 'rounded-md', 'bg-surface-muted/70');
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: t.todos.timePicker })).toHaveClass(
      'bg-elevated',
      'rounded-md',
    );
    await user.click(screen.getByRole('option', { name: '10时' }));
    expect(onChange).toHaveBeenCalledWith('10:00');
  });

  it('clears an optional time value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TimeField label="开始" value="22:00" clearable onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: t.todos.clearTime }));
    expect(onChange).toHaveBeenCalledWith('');
  });
});
