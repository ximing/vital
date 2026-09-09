import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ModelParameters,
  parseModelParameters,
} from '../../../src/features/settings/ModelParameters';

function Harness() {
  const [raw, setRaw] = useState('');
  return (
    <ModelParameters
      modelId="glm-test"
      model={{
        id: 'glm-test',
        name: 'GLM',
        reasoning: true,
        thinkingLevels: ['low', 'high', 'max'],
      }}
      raw={raw}
      onChange={setRaw}
    />
  );
}

describe('model parameters', () => {
  it('offers model-specific reasoning levels and prevents disabling required thinking', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'glm-test thinking' }));
    expect(screen.getByRole('option', { name: '关闭' })).toBeDisabled();
    fireEvent.click(screen.getByRole('option', { name: '开启' }));
    fireEvent.click(screen.getByRole('button', { name: 'glm-test reasoning_effort' }));
    expect(screen.queryByRole('option', { name: 'medium' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'high' }));
    expect(
      JSON.parse((screen.getByLabelText('glm-test 参数 JSON') as HTMLTextAreaElement).value),
    ).toEqual({ thinking: { type: 'enabled' }, reasoning_effort: 'high' });
  });
  it('validates JSON and preserves arbitrary parameters per model', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('glm-test 参数 JSON'), { target: { value: '{bad' } });
    expect(screen.getByRole('alert')).toHaveTextContent('有效的 JSON');
    expect(() => parseModelParameters(['a'], { a: '{bad' })).toThrow();
    expect(
      parseModelParameters(['a', 'b'], {
        a: '{"thinking":{"type":"enabled","budget_tokens":2048}}',
        b: '{"top_k":10}',
      }),
    ).toEqual({
      a: { thinking: { type: 'enabled', budget_tokens: 2048 } },
      b: { top_k: 10 },
    });
    expect(parseModelParameters(['b'], { a: '{"top_k":20}', b: '{}' })).toEqual({ b: {} });
  });
});
