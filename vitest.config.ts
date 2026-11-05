import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Tests never use live credentials, whatever a developer's .env holds. Set but empty, because
 * neither dotenv nor Prisma's loader overwrites a variable that exists. Tests needing a value set their own.
 */
const noLiveCredentials = {
  YOUTUBE_API_ENABLED: "false",
  YOUTUBE_API_KEY: "",
  AUTH_SECRET: "",
  AUTH_GOOGLE_ID: "",
  AUTH_GOOGLE_SECRET: "",
  CRON_SECRET: "",
  STORAGE_PROVIDER: "local",
  STORAGE_ACCESS_KEY: "",
  STORAGE_SECRET_KEY: "",
};

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          env: noLiveCredentials,
          environment: "node",
          include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          env: noLiveCredentials,
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          // All integration test files share one database, so they run one at a time.
          fileParallelism: false,
          // The first run downloads a MongoDB binary, and db push can be slow.
          hookTimeout: 240_000,
          // Generous, because many writes are slow on a nearly full disk.
          testTimeout: 60_000,
        },
      },
    ],
  },
});
