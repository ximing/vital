import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimeField } from '../../src/ui/time-field';

describe('TimeField', () => {
  it('uses the shared field control for time input', () => {
    render(<TimeField label="提醒时间" value="09:00" onChange={vi.fn()} />);

    const input = screen.getByLabelText('提醒时间');
    expect(input).toHaveAttribute('type', 'time');
    expect(input).toHaveClass('rounded-md', 'border', 'border-border');
  });
});
