import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@/copy';
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
    expect(trigger).toHaveClass('h-[var(--field-h)]', 'rounded-md', 'border-border', 'bg-surface');
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: t.calendar.picker })).toHaveClass(
      'bg-elevated',
      'rounded-xl',
    );
    expect(screen.getByRole('option', { name: '9时' })).toBeInTheDocument();
  });

  it('jumps to a year and month from the header, like a date picker decade panel', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DateField
        value="2026-09-07"
        kind="date"
        zone="Asia/Shanghai"
        ariaLabel="日期"
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: '日期' }));
    const dialog = screen.getByRole('dialog', { name: t.calendar.picker });
    expect(within(dialog).getByTestId('calendar-view-date')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: t.calendar.selectYear }));
    expect(within(dialog).getByTestId('calendar-view-year')).toBeInTheDocument();
    expect(within(dialog).getByText('2020–2029')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: t.calendar.prevCentury }));
    expect(within(dialog).getByText('1920–1929')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: t.calendar.nextCentury }));
    expect(within(dialog).getByText('2020–2029')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: '2019年' }));
    expect(within(dialog).getByTestId('calendar-view-month')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: '6月' }));
    expect(within(dialog).getByTestId('calendar-view-date')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: '6月1日' }));
    expect(onChange).toHaveBeenCalledWith('2019-06-01');
  });

  it('opens the month panel from the month header', async () => {
    const user = userEvent.setup();
    render(
      <DateField
        value="2026-09-07"
        kind="date"
        zone="Asia/Shanghai"
        ariaLabel="日期"
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '日期' }));
    const dialog = screen.getByRole('dialog', { name: t.calendar.picker });
    await user.click(within(dialog).getByRole('button', { name: t.calendar.selectMonth }));
    expect(within(dialog).getByTestId('calendar-view-month')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '1月' }));
    expect(within(dialog).getByTestId('calendar-view-date')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '1月1日' })).toBeInTheDocument();
  });
});
