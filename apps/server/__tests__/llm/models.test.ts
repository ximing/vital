import { describe, expect, it } from 'vitest';
import type { User } from '../../src/db/schema.js';
import { encryptSecret } from '../../src/llm/crypto.js';
import { llmCatalog, resolveModelFor } from '../../src/llm/pi.js';

describe('provider model resolution', () => {
  it('offers Zhipu models', () => {
    expect(llmCatalog().find((p) => p.id === 'zhipu')).toMatchObject({
      name: '智谱',
      models: expect.arrayContaining([expect.objectContaining({ id: 'glm-4.7' })]),
    });
  });

  it.each(['zhipu', 'openai', 'anthropic', 'moonshot'])(
    'resolves manually entered models for %s',
    (providerId) => {
      const user = {
        llmProviders: [
          {
            id: 'saved-provider',
            providerId,
            label: providerId,
            apiKeyEnc: encryptSecret('test-key'),
            models: ['future-model'],
          },
        ],
        llmRouting: { default: { providerId: 'saved-provider', model: 'future-model' } },
      } as unknown as User;
      const resolved = resolveModelFor(user, 'default');
      expect(resolved?.model.id).toBe('future-model');
      expect(resolved?.model.baseUrl).toMatch(/^https:\/\//);
      if (providerId === 'zhipu')
        expect(resolved?.model.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4');
    },
  );
});
