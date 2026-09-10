import { describe, expect, it } from 'vitest';
import { isRetryableAgentJobError } from '../../src/agent/job-runtime.js';
import { modelResponseError } from '../../src/llm/model-errors.js';

describe('Agent retry classification', () => {
  it('retries model timeouts and unavailable providers but not invalid credentials or programming errors', () => {
    expect(isRetryableAgentJobError(modelResponseError('aborted'))).toBe(true);
    expect(isRetryableAgentJobError(modelResponseError('error', '503 unavailable'))).toBe(true);
    expect(isRetryableAgentJobError(modelResponseError('error', '401 unauthorized secret-key'))).toBe(false);
    expect(isRetryableAgentJobError(modelResponseError('error', '400 invalid input'))).toBe(false);
    expect(isRetryableAgentJobError(new TypeError('cannot read property 503'))).toBe(false);
    expect(modelResponseError('error', '401 unauthorized secret-key').message).not.toContain('secret-key');
  });
});
