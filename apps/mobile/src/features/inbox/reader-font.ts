import * as SecureStore from 'expo-secure-store';
import type { ReaderFontSize } from '../../ui/reader-font';

// 字号表与循环逻辑在 src/ui/reader-font.ts（中性位置）；此处仅保留 SecureStore 持久化。
export {
  READER_FONT_ORDER,
  READER_FONT_STEPS,
  nextReaderFontSize,
  type ReaderFontSize,
} from '../../ui/reader-font';

const KEY = 'vital.inbox.fontSize';

export async function loadReaderFontSize(): Promise<ReaderFontSize> {
  const raw = await SecureStore.getItemAsync(KEY).catch(() => null);
  return raw === 'sm' || raw === 'md' || raw === 'lg' ? raw : 'md';
}

export function saveReaderFontSize(size: ReaderFontSize): void {
  void SecureStore.setItemAsync(KEY, size).catch(() => undefined);
}
