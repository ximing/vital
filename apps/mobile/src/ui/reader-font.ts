/**
 * 阅读器字号表（中性位置，供 components/InboxReader 与 features/inbox 共用）。
 * 三档 sm/md/lg = 14/16/18，行距 1.75 倍。SecureStore 持久化逻辑留在
 * features/inbox/reader-font.ts（业务侧关注点）。
 */
export type ReaderFontSize = 'sm' | 'md' | 'lg';

export const READER_FONT_ORDER: ReaderFontSize[] = ['sm', 'md', 'lg'];

export const READER_FONT_STEPS: Record<ReaderFontSize, { fontSize: number; lineHeight: number }> =
  {
    sm: { fontSize: 14, lineHeight: 24.5 },
    md: { fontSize: 16, lineHeight: 28 },
    lg: { fontSize: 18, lineHeight: 31.5 },
  };

export function nextReaderFontSize(size: ReaderFontSize): ReaderFontSize {
  const idx = READER_FONT_ORDER.indexOf(size);
  return READER_FONT_ORDER[(idx + 1) % READER_FONT_ORDER.length] ?? 'md';
}
