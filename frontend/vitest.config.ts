import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Mirrors vite.config.ts. Without it vitest falls back to node resolution and
      // loads the package's BUILT dist/, which has two consequences: the tests fail
      // outright wherever dist has not been built (CI never builds it for this job),
      // and where it has, they silently exercise a possibly stale copy while the bundle
      // is built from src. Tests and bundle must resolve to the same source.
      '@borderfall/warfront-sim': path.resolve(__dirname, '../packages/warfront-sim/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['tests/**', 'node_modules/**'],
  },
});
