import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LlmParametersEditor } from '../../../src/features/settings/LlmParametersEditor';

function Editor() {
  const [value, setValue] = useState(
    '{"custom":{"keep":true},"thinking":{"type":"enabled","clear_thinking":false}}',
  );
  return <LlmParametersEditor value={value} onChange={setValue} />;
}

describe('model parameter editor', () => {
  it('updates common controls without losing provider-specific parameters', async () => {
    const user = userEvent.setup();
    render(<Editor />);
    await user.selectOptions(screen.getByLabelText('深度思考（thinking）'), 'disabled');
    await user.type(screen.getByLabelText('推理强度（reasoning_effort）'), 'low');
    const json = (screen.getByLabelText('参数 JSON') as HTMLTextAreaElement).value;
    expect(JSON.parse(json)).toEqual({
      custom: { keep: true },
      thinking: { type: 'disabled', clear_thinking: false },
      reasoning_effort: 'low',
    });
  });

  it('validates JSON and prevents shortcuts from overwriting invalid edits', () => {
    render(<Editor />);
    fireEvent.change(screen.getByLabelText('参数 JSON'), { target: { value: '{' } });
    expect(screen.getByRole('alert')).toHaveTextContent('有效的 JSON');
    expect(screen.getByLabelText('深度思考（thinking）')).toBeDisabled();
    expect(screen.getByLabelText('参数 JSON')).toHaveValue('{');
  });

  it('omits default parameters rather than sending an unsupported value', async () => {
    const user = userEvent.setup();
    render(<Editor />);
    await user.selectOptions(screen.getByLabelText('深度思考（thinking）'), '');
    expect(JSON.parse((screen.getByLabelText('参数 JSON') as HTMLTextAreaElement).value)).toEqual({
      custom: { keep: true },
    });
  });
});
