import { useId } from 'react';
import { parseLlmParameters, type LlmParameters } from '@vital/dto';
import { t } from '@/copy';
import { Field, FIELD_CONTROL_CLASS } from '@/ui/field';

export function LlmParametersEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  let parameters: LlmParameters = {};
  let error: string | undefined;
  try {
    parameters = parseLlmParameters(value);
  } catch (err) {
    error = err instanceof Error ? err.message : t.settings.llm.parametersInvalid;
  }
  const thinking = parameters.thinking;
  const thinkingObject =
    typeof thinking === 'object' && thinking !== null && !Array.isArray(thinking) ? thinking : {};

  function change(key: string, next: LlmParameters[string] | undefined) {
    const updated = { ...parameters };
    if (next === undefined) delete updated[key];
    else updated[key] = next;
    onChange(JSON.stringify(updated, null, 2));
  }

  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <legend className="px-1 text-sm font-medium">{t.settings.llm.parameters}</legend>
      <p className="text-sm text-muted">{t.settings.llm.parametersHint}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-thinking`} className="text-sm text-muted">
            {t.settings.llm.thinking}
          </label>
          <select
            id={`${id}-thinking`}
            className={FIELD_CONTROL_CLASS}
            disabled={Boolean(error)}
            value={typeof thinkingObject.type === 'string' ? thinkingObject.type : ''}
            onChange={(event) =>
              change(
                'thinking',
                event.target.value === ''
                  ? undefined
                  : { ...thinkingObject, type: event.target.value },
              )
            }
          >
            <option value="">{t.settings.llm.providerDefault}</option>
            <option value="enabled">{t.settings.llm.thinkingEnabled}</option>
            <option value="disabled">{t.settings.llm.thinkingDisabled}</option>
          </select>
        </div>
        <Field
          label={t.settings.llm.reasoningEffort}
          disabled={Boolean(error)}
          value={typeof parameters.reasoning_effort === 'string' ? parameters.reasoning_effort : ''}
          list={`${id}-efforts`}
          placeholder={t.settings.llm.providerDefault}
          autoComplete="off"
          onChange={(event) => change('reasoning_effort', event.target.value || undefined)}
        />
        <datalist id={`${id}-efforts`}>
          {['low', 'medium', 'high', 'max', 'minimal', 'none', 'xhigh'].map((effort) => (
            <option key={effort} value={effort} />
          ))}
        </datalist>
      </div>
      <p className="text-sm text-muted">{t.settings.llm.thinkingHint}</p>
      <label htmlFor={`${id}-json`} className="text-sm text-muted">
        {t.settings.llm.parametersJson}
      </label>
      <textarea
        id={`${id}-json`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={7}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${FIELD_CONTROL_CLASS} h-auto min-h-40 resize-y py-3 font-mono text-sm`}
        placeholder={
          '{\n  "thinking": { "type": "enabled" },\n  "reasoning_effort": "low",\n  "max_tokens": 4096\n}'
        }
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
