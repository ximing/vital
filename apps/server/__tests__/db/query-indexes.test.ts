import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { attachments, inboxItemTags, inboxItems, refreshTokens, tags, taskTags, tasks } from '../../src/db/schema.js';

function indexNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).indexes.map((index) => index.config.name).filter((name): name is string => Boolean(name));
}

describe('query indexes', () => {
  it('covers task parent, habit, and live-status scans', () => {
    const names = indexNames(tasks);
    expect(names).toContain('idx_tasks_user_parent');
    expect(names).toContain('idx_tasks_user_habit');
    expect(names).toContain('idx_tasks_live_status_due');
    expect(names).toContain('idx_tasks_open_notify');
  });

  it('covers inbox status, outcome, and live-captured scans', () => {
    const names = indexNames(inboxItems);
    expect(names).toContain('idx_inbox_items_user_status_captured');
    expect(names).toContain('idx_inbox_items_user_outcome');
    expect(names).toContain('idx_inbox_items_live_captured');
  });

  it('covers tag reverse lookups and token/upload sweeps', () => {
    expect(indexNames(taskTags)).toContain('idx_task_tags_tag');
    expect(indexNames(inboxItemTags)).toContain('idx_inbox_item_tags_tag');
    expect(indexNames(refreshTokens)).toContain('idx_refresh_tokens_expires');
    expect(indexNames(attachments)).toContain('idx_attachments_status_created');
    expect(indexNames(tags)).toContain('tags_user_lower_name_uidx');
  });
});
