import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.browser.ts",
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["junit", { outputFile: "test-results/browser.xml" }],
  ],
  use: {
    browserName: "chromium",
    baseURL: "http://127.0.0.1:1430",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm run dev -- --port 1430",
      url: "http://127.0.0.1:1430",
      reuseExistingServer: false,
    },
    {
      command: "npm run preview -- --port 1431",
      url: "http://127.0.0.1:1431",
      reuseExistingServer: false,
    },
  ],
});
