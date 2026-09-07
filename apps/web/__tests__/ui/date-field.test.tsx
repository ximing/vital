import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DateField } from '../../src/ui/date-field';

describe('DateField', () => {
  it('uses the shared field and popover treatment for a date-time value', async () => {
    const user = userEvent.setup();
    render(
      <DateField
        value="2026-09-07T09:00"
        kind="datetime-local"
        zone="Asia/Shanghai"
        ariaLabel="提醒时间"
        onChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button', { name: '提醒时间' });
    expect(trigger).toHaveClass('h-[var(--field-h)]', 'rounded-md');
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: '日期选择器' })).toHaveClass(
      'bg-elevated',
      'rounded-md',
    );
    expect(screen.getByRole('option', { name: '9时' })).toBeInTheDocument();
  });
});
