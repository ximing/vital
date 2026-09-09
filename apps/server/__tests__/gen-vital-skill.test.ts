import { createTaskInputSchema } from '@vital/dto';
import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  apiMarkdownPath,
  generateApiMarkdown,
  parseRouteSource,
  printZodFields,
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

  it('prints create-task fields from the dto schema', () => {
    const fields = printZodFields(createTaskInputSchema).join('\n');
    expect(fields).toContain('`title`');
    expect(fields).toContain('`listId`');
    expect(fields).toContain('uuid');
  });

  it('generated catalog includes live routes and matches the committed file', async () => {
    const markdown = await generateApiMarkdown();
    expect(markdown).toContain('POST /api/v1/tokens');
    expect(markdown).toContain('POST /api/v1/tasks');
    expect(markdown).toContain('GET /api/v1/sync/head');
    expect(markdown).toContain('`listId`');
    expect(markdown).toContain('TOKEN_LIMIT_REACHED');
    expect(markdown).toContain('export interface CreatedApiToken');
    expect(markdown).toContain('export interface Report extends ReportListItem');
    const tokenGet = markdown.split('#### `GET /api/v1/tokens`')[1]?.split('#### ')[0] ?? '';
    expect(tokenGet).toContain('Client: `listApiTokens`');
    expect(tokenGet).not.toContain('createApiTokenInputSchema');
    expect(tokenGet).not.toContain('listApiTokenAccessQuerySchema');
    const committed = await fs.readFile(apiMarkdownPath, 'utf8');
    expect(committed).toBe(markdown);
  });
});
