import { defineConfig, devices } from "@playwright/test";
import { E2E_DATABASE_READY_PORT, E2E_DATABASE_URL } from "./tests/e2e/support/constants";

const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL,
    locale: "ar",
    trace: "on-first-retry",
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      command: "npx tsx tests/e2e/support/database-server.ts",
      url: `http://127.0.0.1:${E2E_DATABASE_READY_PORT}`,
      reuseExistingServer: !process.env.CI,
      // Creating about 100 indexes is slow on a nearly full disk.
      timeout: 420_000,
    },
    {
      // E2E_SERVER=production tests a finished build, after `npm run build`. It needs far less
      // memory than the dev compiler, but development-only pages return 404 there.
      command: process.env.E2E_SERVER === "production" ? `npm start -- --port ${port}` : `npm run dev -- --port ${port}`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        DATABASE_URL: E2E_DATABASE_URL,
        APP_URL: baseURL,
        NEXTAUTH_URL: baseURL,
        // Placeholders. They let the sign-in page work up to the point of leaving for Google.
        AUTH_SECRET: "e2e-only-secret-not-used-anywhere-else",
        AUTH_GOOGLE_ID: "e2e-client-id",
        AUTH_GOOGLE_SECRET: "e2e-client-secret",
        CRON_SECRET: "e2e-only-cron-secret-not-used-anywhere-else",
        // Off, so nothing here can reach the real YouTube Data API.
        YOUTUBE_API_ENABLED: "false",
        YOUTUBE_API_KEY: "",
        STORAGE_PROVIDER: "local",
        STORAGE_ACCESS_KEY: "",
        STORAGE_SECRET_KEY: "",
        STORAGE_LOCAL_DIR: ".data/e2e-uploads",
      },
    },
  ],
});
