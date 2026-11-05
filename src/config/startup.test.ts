import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// getEnv caches its result, so each test loads a fresh copy of the module.
async function loadStartup() {
  vi.resetModules();
  return import("./startup");
}

describe("validateEnvironmentOnStartup", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  // Its first import can take seconds on a busy machine, which says nothing about the behaviour.
  it("exits with a clear message when configuration is invalid", { timeout: 30_000 }, async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("APP_URL", "");
    const { validateEnvironmentOnStartup } = await loadStartup();

    validateEnvironmentOnStartup();

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("DATABASE_URL"));
  });

  it("does nothing when configuration is valid", async () => {
    vi.stubEnv("DATABASE_URL", "mongodb://127.0.0.1:27017/muslim?replicaSet=rs0");
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.stubEnv("NODE_ENV", "development");
    const { validateEnvironmentOnStartup } = await loadStartup();

    validateEnvironmentOnStartup();

    expect(process.exit).not.toHaveBeenCalled();
  });
});
