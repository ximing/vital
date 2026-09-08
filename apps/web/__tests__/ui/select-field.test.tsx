import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SelectField } from '../../src/ui/select-field';

describe('SelectField', () => {
  it('opens a shared popover and writes the selected value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SelectField
        value="none"
        ariaLabel="重复"
        options={[
          { value: 'none', label: '不重复' },
          { value: 'daily', label: '每天' },
        ]}
        onChange={onChange}
      />,
    );

    const trigger = screen.getByRole('button', { name: '重复' });
    expect(trigger).toHaveClass('h-[var(--field-h)]', 'rounded-md', 'border-border', 'bg-surface');
    await user.click(trigger);
    expect(screen.getByRole('listbox', { name: '重复' })).toHaveClass('bg-elevated', 'rounded-xl', 'border-border');
    await user.click(screen.getByRole('option', { name: '每天' }));
    expect(onChange).toHaveBeenCalledWith('daily');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
