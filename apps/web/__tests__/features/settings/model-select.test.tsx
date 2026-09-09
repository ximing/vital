import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ModelSelect } from '../../../src/features/settings/ModelSelect';

function Harness() {
  const [value, setValue] = useState<string[]>([]);
  return (
    <ModelSelect options={[{ id: 'glm-4.7', name: 'GLM 4.7' }]} value={value} onChange={setValue} />
  );
}

describe('model selection', () => {
  it('selects suggestions, adds custom IDs, prevents duplicates and removes models', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.click(screen.getByRole('option', { name: 'GLM 4.7 · glm-4.7' }));
    expect(screen.getByRole('button', { name: '移除模型 glm-4.7' })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '  future-model  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('button', { name: '移除模型 future-model' })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'future-model' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getAllByRole('button', { name: '移除模型 future-model' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '移除模型 future-model' }));
    expect(screen.queryByRole('button', { name: '移除模型 future-model' })).not.toBeInTheDocument();
  });

  it('supports keyboard selection and preserves IME composition', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('button', { name: '移除模型 glm-4.7' })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'composing' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(screen.queryByRole('button', { name: '移除模型 composing' })).not.toBeInTheDocument();
  });
});
