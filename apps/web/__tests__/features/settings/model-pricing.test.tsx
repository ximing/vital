import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  emptyLlmModelPricingDraft,
  parseLlmModelPricingDraft,
  type LlmModelPricingDraft,
} from '@vital/dto';
import { t } from '@/copy';
import { ModelPricing } from '../../../src/features/settings/ModelPricing';

function Harness() {
  const [draft, setDraft] = useState<LlmModelPricingDraft>(emptyLlmModelPricingDraft());
  let parsed: unknown = null;
  try {
    parsed = parseLlmModelPricingDraft(draft) ?? null;
  } catch {
    parsed = 'invalid';
  }
  return (
    <>
      <ModelPricing
        modelId="glm-test"
        model={{
          id: 'glm-test',
          name: 'GLM',
          cost: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
        }}
        draft={draft}
        onChange={setDraft}
      />
      <pre data-testid="pricing-json">{JSON.stringify(parsed)}</pre>
    </>
  );
}

describe('model pricing', () => {
  it('edits default rates and an overnight window', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText(`${t.settings.llm.pricing} · glm-test`));
    fireEvent.change(screen.getByLabelText(`${t.settings.llm.pricingInput} · input`), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByLabelText(`${t.settings.llm.pricingOutput} · output`), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: t.settings.llm.pricingAddWindow }));
    fireEvent.change(screen.getAllByLabelText(t.settings.llm.pricingWindowStart)[0]!, {
      target: { value: '22:00' },
    });
    fireEvent.change(screen.getAllByLabelText(t.settings.llm.pricingWindowEnd)[0]!, {
      target: { value: '08:00' },
    });
    fireEvent.change(screen.getAllByLabelText(`${t.settings.llm.pricingInput} · input`)[1]!, {
      target: { value: '0.1' },
    });
    expect(JSON.parse(screen.getByTestId('pricing-json').textContent ?? '')).toEqual({
      input: 1,
      output: 2,
      windows: [{ start: '22:00', end: '08:00', input: 0.1 }],
    });
    expect(screen.getByText(/目录 0.15 \/ 0.6/)).toBeInTheDocument();
  });
});
