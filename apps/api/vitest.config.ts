import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // PGlite (WASM Postgres) boots slowly when several test files start in parallel.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
