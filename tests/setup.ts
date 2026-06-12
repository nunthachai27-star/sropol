import '@testing-library/jest-dom/vitest';

// Deterministic Web Storage for every jsdom test.
//
// Some runtimes (and the agent sandbox here) start Node with its experimental
// localStorage enabled via `--localstorage-file`. When that flag arrives
// without a valid path, Node installs a global `localStorage` that shadows
// jsdom's and is missing parts of the API — `localStorage.clear()` throws
// "is not a function", which aborts any test whose beforeEach clears storage.
// Install a complete in-memory Storage so tests behave identically regardless
// of how the runtime was launched.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(String(key), String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  const value = new MemoryStorage();
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  if (typeof window !== 'undefined' && window !== (globalThis as unknown as Window)) {
    Object.defineProperty(window, name, { value, writable: true, configurable: true });
  }
}
