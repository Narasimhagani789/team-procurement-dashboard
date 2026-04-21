import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for end-to-end tests against the deployed dashboard.
 *
 * Override the target URL via env:
 *   BASE_URL=https://team-procurement-dashboard.vercel.app npm run test:e2e
 *
 * Defaults to the production Vercel URL so `npm run test:e2e` Just Works.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL:
      process.env.BASE_URL ?? "https://team-procurement-dashboard.vercel.app",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
