import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { resetInboxUi } from '@/features/inbox/inbox-ui.service';
import { resetReportUi } from '@/features/reports/report-ui.service';
import { resetTodosUi } from '@/features/todos/todos-ui.service';
import { registerSessionUiServicesForTest, registerVitalServices } from '@/services/register';

class MemoryStorage implements Storage {
  readonly #items = new Map<string, string>();

  get length(): number {
    return this.#items.size;
  }

  clear(): void {
    this.#items.clear();
  }

  getItem(key: string): string | null {
    return this.#items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#items.set(key, String(value));
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() });
}

registerVitalServices();
registerSessionUiServicesForTest();

afterEach(() => {
  cleanup();
  resetTodosUi();
  resetInboxUi();
  resetReportUi();
});
