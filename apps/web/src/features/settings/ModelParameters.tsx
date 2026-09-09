import { useId } from 'react';
import { parseLlmParameters, type LlmCatalogModel, type LlmParameters } from '@vital/dto';
import { Field, FIELD_CONTROL_CLASS } from '@/ui/field';
import { SelectField } from '@/ui/select-field';

export function parseModelParameters(models: string[], drafts: Record<string, string>) {
  return Object.fromEntries(models.map((id) => [id, parseLlmParameters(drafts[id] ?? '')]));
}

export function ModelParameters({
  modelId,
  model,
  raw,
  onChange,
}: {
  modelId: string;
  model?: LlmCatalogModel | undefined;
  raw: string;
  onChange: (raw: string) => void;
}) {
  const id = useId();
  let parameters: LlmParameters = {};
  let error = '';
  try {
    parameters = parseLlmParameters(raw);
  } catch (err) {
    error = err instanceof Error ? err.message : '参数格式错误';
  }
  const thinking = parameters.thinking;
  const thinkingType =
    thinking && typeof thinking === 'object' && !Array.isArray(thinking)
      ? String(thinking.type ?? '')
      : '';
  const required =
    model?.reasoning && model.thinkingLevels && !model.thinkingLevels.includes('off');
  const levels = model?.thinkingLevels?.filter((level) => level !== 'off') ?? [
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
  ];
  const effort = typeof parameters.reasoning_effort === 'string' ? parameters.reasoning_effort : '';
  const canThink = model?.reasoning !== false;
  function update(key: string, value: LlmParameters[string] | undefined) {
    const next = { ...parameters };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(JSON.stringify(next, null, 2));
  }
  return (
    <details open className="rounded-xl border border-border bg-surface p-3">
      <summary className="cursor-pointer text-sm font-medium">{modelId} 参数</summary>
      <div className="mt-3 flex flex-col gap-3">
        {canThink ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-sm text-muted">思考模式 · thinking</p>
              <SelectField
                ariaLabel={`${modelId} thinking`}
                value={thinkingType}
                disabled={Boolean(error)}
                options={[
                  { value: '', label: required ? '自动（必须开启）' : '自动' },
                  { value: 'enabled', label: '开启' },
                  { value: 'disabled', label: '关闭', disabled: Boolean(required) },
                ]}
                onChange={(value) => {
                  const next = { ...parameters };
                  if (!value) delete next.thinking;
                  else
                    next.thinking = {
                      ...(thinking && typeof thinking === 'object' && !Array.isArray(thinking)
                        ? thinking
                        : {}),
                      type: value,
                    };
                  if (value === 'disabled') delete next.reasoning_effort;
                  onChange(JSON.stringify(next, null, 2));
                }}
              />
            </div>
            <div>
              <p className="mb-1 text-sm text-muted">推理强度 · reasoning_effort</p>
              <SelectField
                ariaLabel={`${modelId} reasoning_effort`}
                value={effort}
                disabled={Boolean(error) || thinkingType === 'disabled'}
                options={[
                  { value: '', label: '自动' },
                  ...Array.from(new Set([...levels, ...(effort ? [effort] : [])])).map((value) => ({
                    value,
                    label: value,
                  })),
                ]}
                onChange={(value) => update('reasoning_effort', value || undefined)}
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">
            模型目录未标记思考能力；供应商特有参数可在下方 JSON 中配置。
          </p>
        )}
        {required ? (
          <p className="text-sm text-muted">
            此模型必须开启思考；自动使用最低支持强度 {levels[0]}。
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="温度 · temperature"
            type="number"
            min={0}
            max={2}
            step="any"
            disabled={Boolean(error)}
            value={typeof parameters.temperature === 'number' ? parameters.temperature : ''}
            placeholder="默认"
            onChange={(event) =>
              update(
                'temperature',
                event.target.value === '' ? undefined : Number(event.target.value),
              )
            }
          />
          <Field
            label="最大输出 · max_tokens"
            type="number"
            min={1}
            step={1}
            disabled={Boolean(error) || parameters.max_completion_tokens !== undefined}
            value={typeof parameters.max_tokens === 'number' ? parameters.max_tokens : ''}
            placeholder="默认"
            onChange={(event) =>
              update(
                'max_tokens',
                event.target.value === '' ? undefined : Number(event.target.value),
              )
            }
          />
        </div>
        <label htmlFor={id} className="text-sm text-muted">
          完整参数 JSON（支持供应商自定义参数）
        </label>
        <textarea
          id={id}
          aria-label={`${modelId} 参数 JSON`}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${FIELD_CONTROL_CLASS} min-h-28 w-full py-2 font-mono text-sm`}
          value={raw}
          spellCheck={false}
          placeholder="{}"
          onChange={(event) => onChange(event.target.value)}
        />
        {error ? (
          <p id={`${id}-error`} role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
