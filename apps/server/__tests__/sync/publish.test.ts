import { describe, expect, it } from 'vitest';
import { isMutatingApi, shouldPublish } from '../../src/sync/sync-publish.js';

describe('isMutatingApi', () => {
  it('accepts writes under /api/v1 except auth, sync, and search', () => {
    expect(isMutatingApi('POST', '/api/v1/tasks')).toBe(true);
    expect(isMutatingApi('PATCH', '/api/v1/tasks/abc?x=1')).toBe(true);
    expect(isMutatingApi('DELETE', '/api/v1/inbox/abc')).toBe(true);
    expect(isMutatingApi('PUT', '/api/v1/tasks/reorder')).toBe(true);
    expect(isMutatingApi('POST', '/api/v1/reports/abc/fill')).toBe(true);
    expect(isMutatingApi('GET', '/api/v1/tasks')).toBe(false);
    expect(isMutatingApi('POST', '/api/v1/auth/login')).toBe(false);
    expect(isMutatingApi('PATCH', '/api/v1/auth/me')).toBe(false);
    expect(isMutatingApi('POST', '/api/v1/sync/changes')).toBe(false);
    expect(isMutatingApi('POST', '/api/v1/search')).toBe(false);
    expect(isMutatingApi('POST', '/api/health')).toBe(false);
  });
});

describe('shouldPublish', () => {
  it('requires a user and 2xx mutating write', () => {
    expect(shouldPublish('POST', '/api/v1/tasks', 201, 'u1')).toBe(true);
    expect(shouldPublish('POST', '/api/v1/tasks', 201, undefined)).toBe(false);
    expect(shouldPublish('POST', '/api/v1/tasks', 400, 'u1')).toBe(false);
    expect(shouldPublish('GET', '/api/v1/tasks', 200, 'u1')).toBe(false);
  });
});
