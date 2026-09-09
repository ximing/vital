import { describe, expect, it } from 'vitest';
import {
  CAPTURE_DEFAULT,
  CAPTURE_MAX,
  CAPTURE_MIN,
  clampInboxListWidth,
  clampPaneWidth,
  INBOX_LIST_DEFAULT,
  INBOX_LIST_MAX,
  INBOX_LIST_MIN,
  LIBRARY_DEFAULT,
  LIBRARY_MAX,
  LIBRARY_MIN,
} from '../../src/shell/chrome';

describe('chrome layout', () => {
  it('clamps the library pane between min and max', () => {
    expect(clampPaneWidth(0)).toBe(LIBRARY_MIN);
    expect(clampPaneWidth(9999)).toBe(LIBRARY_MAX);
    expect(clampPaneWidth(240)).toBe(240);
  });

  it('clamps the capture pane in the library range', () => {
    expect(clampPaneWidth(0, 'capture')).toBe(CAPTURE_MIN);
    expect(clampPaneWidth(9999, 'capture')).toBe(CAPTURE_MAX);
    expect(clampPaneWidth(300, 'capture')).toBe(CAPTURE_MAX);
    expect(clampPaneWidth(240, 'reflect')).toBe(240);
  });

  it('uses the Mineral Garden library range', () => {
    expect(LIBRARY_MIN).toBe(224);
    expect(LIBRARY_DEFAULT).toBe(248);
    expect(LIBRARY_MAX).toBe(264);
  });

  it('keeps the capture pane on the library range', () => {
    expect(CAPTURE_MIN).toBe(224);
    expect(CAPTURE_DEFAULT).toBe(248);
    expect(CAPTURE_MAX).toBe(264);
  });

  it('clamps the inbox list column in its own range', () => {
    expect(INBOX_LIST_MIN).toBe(320);
    expect(INBOX_LIST_DEFAULT).toBe(360);
    expect(INBOX_LIST_MAX).toBe(520);
    expect(clampInboxListWidth(0)).toBe(INBOX_LIST_MIN);
    expect(clampInboxListWidth(9999)).toBe(INBOX_LIST_MAX);
    expect(clampInboxListWidth(420)).toBe(420);
  });
});
