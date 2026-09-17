import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
import { resetDb } from './helpers/db.js';
import { injectJson } from './helpers/http.js';
import { registerUser } from './helpers/session.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(resetDb);

afterAll(async () => {
  await app.close();
});

describe('days', () => {
  it('seeds seven statutory holidays on first list', async () => {
    const alice = await registerUser(app);
    const list = await injectJson(app, { method: 'GET', url: '/api/v1/days', token: alice.token });
    expect(list.statusCode).toBe(200);
    const items = list.json().items as { name: string; source: string; canDelete: boolean }[];
    expect(items).toHaveLength(7);
    expect(items.every((item) => item.source === 'statutory' && !item.canDelete)).toBe(true);
    expect(items.map((item) => item.name).sort()).toEqual(
      ['元旦', '劳动节', '国庆节', '春节', '清明节', '端午节', '中秋节'].sort(),
    );
  });

  it('hides a statutory holiday and forbids delete', async () => {
    const alice = await registerUser(app);
    const list = await injectJson(app, { method: 'GET', url: '/api/v1/days', token: alice.token });
    const spring = (list.json().items as { id: string; name: string }[]).find((item) => item.name === '春节');
    expect(spring).toBeTruthy();
    if (!spring) return;
    const hidden = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/days/${spring.id}`,
      token: alice.token,
      payload: { hidden: true },
    });
    expect(hidden.statusCode).toBe(200);
    const after = await injectJson(app, { method: 'GET', url: '/api/v1/days', token: alice.token });
    expect((after.json().items as { name: string }[]).some((item) => item.name === '春节')).toBe(false);
    const del = await injectJson(app, {
      method: 'DELETE',
      url: `/api/v1/days/${spring.id}`,
      token: alice.token,
    });
    expect(del.statusCode).toBe(400);
    expect(del.json().error.code).toBe('DAY_NOT_DELETABLE');
  });

  it('creates a custom countdown and adds a catalog festival', async () => {
    const alice = await registerUser(app);
    await injectJson(app, { method: 'GET', url: '/api/v1/days', token: alice.token });
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/days',
      token: alice.token,
      payload: {
        name: '出国',
        calendar: 'solar',
        anchorYmd: DateTime.now().setZone('Asia/Shanghai').plus({ days: 20 }).toISODate(),
        displayMode: 'countdown',
        reminderOffsets: [7, 0],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().headline.kind).toBe('countdown');
    expect(created.json().headline.days).toBe(20);

    const qixi = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/days',
      token: alice.token,
      payload: { catalogKey: 'cn.qixi' },
    });
    expect(qixi.statusCode).toBe(201);
    expect(qixi.json().name).toBe('七夕');
    expect(qixi.json().source).toBe('catalog');
    expect(qixi.json().calendar).toBe('lunar');
  });

  it('exposes the nearest day within 7 days on today pulse', async () => {
    const alice = await registerUser(app);
    const today = await injectJson(app, { method: 'GET', url: '/api/v1/today', token: alice.token });
    expect(today.statusCode).toBe(200);
    const pulse = today.json().pulse as {
      upcomingDay: { name: string; daysUntil: number } | null;
    };
    expect(pulse.upcomingDay === null || typeof pulse.upcomingDay.daysUntil === 'number').toBe(true);
    if (pulse.upcomingDay) {
      expect(pulse.upcomingDay.daysUntil).toBeGreaterThanOrEqual(0);
      expect(pulse.upcomingDay.daysUntil).toBeLessThanOrEqual(7);
    }
  });
});
