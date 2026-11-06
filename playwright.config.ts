import { defineConfig } from '@playwright/test';

// End-to-end tests run against a running stack (`npm run dev` or `docker compose up`).
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: process.env.STORE_URL ?? 'http://localhost:3000',
  },
});
