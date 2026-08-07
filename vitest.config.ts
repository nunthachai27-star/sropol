import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    // PGlite (embedded Postgres, WASM) boots in ~2-3s idle but can exceed 5s
    // when the whole suite saturates the CPU. Files pay that cost once, on
    // their first DB touch — which may sit inside a test body, not a hook.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'tests/', '.next/', 'src/components/ui/'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
