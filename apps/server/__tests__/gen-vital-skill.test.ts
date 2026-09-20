import { createTaskInputSchema } from '@vital/dto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  generateApiCatalog,
  normalizeClientPath,
  parseRouteSource,
  printZodFields,
  referencesDir,
} from '../scripts/gen-vital-skill.js';

describe('gen-vital-skill', () => {
  it('parses route methods, auth, and schema names', () => {
    const routes = parseRouteSource(`
      /** Create a personal access token. The secret is returned once. */
      app.post('/api/v1/tokens', { preHandler: [requireAuth] }, async (req, reply) => {
        const created = await createApiToken(user.id, createApiTokenInputSchema.parse(req.body));
        return reply.code(201).send(created);
      });
      app.get('/api/v1/sync/events', { websocket: true }, (socket) => {
        attachSyncSocket(socket);
      });
    `);
    expect(routes).toEqual([
      {
        method: 'POST',
        path: '/api/v1/tokens',
        auth: true,
        websocket: false,
        bodySchema: 'createApiTokenInputSchema',
        status: 201,
        description: 'Create a personal access token. The secret is returned once.',
      },
      {
        method: 'GET',
        path: '/api/v1/sync/events',
        auth: false,
        websocket: true,
      },
    ]);
  });

  it('normalizes interpolated client paths', () => {
    expect(normalizeClientPath('/api/v1/habits/${id}')).toBe('/api/v1/habits/:id');
    expect(normalizeClientPath('/api/v1/agent/schedule/${capability}/cancel')).toBe(
      '/api/v1/agent/schedule/:capability/cancel',
    );
    expect(normalizeClientPath('/api/v1/outcomes')).toBe('/api/v1/outcomes');
  });

  it('parses template-literal route paths', () => {
    const routes = parseRouteSource(`
      app.post(\`/api/v1/habits/\${id}/tick\`, { preHandler: [requireAuth] }, async (req) => {
        return tickHabit(idParamsSchema.parse(req.params).id);
      });
    `);
    expect(routes[0]).toMatchObject({
      method: 'POST',
      path: '/api/v1/habits/:id/tick',
      auth: true,
    });
  });

  it('prints create-task fields from the dto schema', () => {
    const fields = printZodFields(createTaskInputSchema).join('\n');
    expect(fields).toContain('`title`');
    expect(fields).toContain('`listId`');
    expect(fields).toContain('uuid');
  });

  it('generated catalog is split by module and matches committed files', async () => {
    const catalog = await generateApiCatalog();
    expect(catalog['index.md']).toContain('inbox.md');
    expect(catalog['common.md']).toContain('TOKEN_LIMIT_REACHED');
    expect(catalog['tokens.md']).toContain('POST /api/v1/tokens');
    expect(catalog['tokens.md']).toContain('export interface CreatedApiToken');
    expect(catalog['tasks.md']).toContain('POST /api/v1/tasks');
    expect(catalog['tasks.md']).toContain('`listId`');
    expect(catalog['tasks.md']).not.toContain('TOKEN_LIMIT_REACHED');
    expect(catalog['sync.md']).toContain('GET /api/v1/sync/head');
    expect(catalog['reports.md']).toContain('export interface Report extends ReportListItem');
    expect(catalog['app.md']).toContain('export interface AppLatestReleaseResponse');
    expect(catalog['inbox.md']).toContain('export type InboxPreview');
    expect(catalog['agent.md']).toContain('POST /api/v1/agent/cluster');
    expect(catalog['agent.md']).toContain('POST /api/v1/agent/memory/distill');
    expect(catalog['agent.md']).toContain('Client: `organizeAgentTasks`');
    expect(catalog['agent.md']).toContain('Client: `listAgentExecutions`');
    expect(catalog['outcomes.md']).toContain('Client: `listOutcomes`');
    const cancel =
      catalog['agent.md']
        ?.split('#### `POST /api/v1/agent/schedule/:capability/cancel`')[1]
        ?.split('#### ')[0] ?? '';
    expect(cancel).toContain('"outcome.cluster"');
    expect(cancel).not.toContain('`capability`: uuid');
    const tokenGet = catalog['tokens.md']?.split('#### `GET /api/v1/tokens`')[1]?.split('#### ')[0] ?? '';
    expect(tokenGet).toContain('Client: `listApiTokens`');
    expect(tokenGet).not.toContain('createApiTokenInputSchema');
    expect(tokenGet).not.toContain('listApiTokenAccessQuerySchema');
    expect(Object.keys(catalog).sort()).toEqual(
      (await fs.readdir(referencesDir)).filter((name) => name.endsWith('.md')).sort(),
    );
    for (const [name, body] of Object.entries(catalog)) {
      const committed = await fs.readFile(path.join(referencesDir, name), 'utf8');
      expect(committed, name).toBe(body);
    }
  });
});
