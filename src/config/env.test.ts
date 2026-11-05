import { describe, expect, it } from "vitest";
import { InvalidEnvironmentError, parseEnv } from "./env";

const valid = {
  DATABASE_URL: "mongodb://127.0.0.1:27017/muslim?replicaSet=rs0",
  APP_URL: "http://localhost:3000",
};

const production = {
  ...valid,
  NODE_ENV: "production",
  AUTH_SECRET: "x".repeat(32),
  AUTH_GOOGLE_ID: "id",
  AUTH_GOOGLE_SECRET: "secret",
  NEXTAUTH_URL: "https://example.com",
};

function problemsOf(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof InvalidEnvironmentError) return error.problems;
    throw error;
  }
  return [];
}

describe("parseEnv", () => {
  it("accepts a minimal development configuration and applies defaults", () => {
    const env = parseEnv(valid);
    expect(env.NODE_ENV).toBe("development");
    expect(env.YOUTUBE_API_ENABLED).toBe(false);
    expect(env.STORAGE_PROVIDER).toBe("local");
  });

  it("names every missing required variable", () => {
    const problems = problemsOf({});
    expect(problems.some((p) => p.startsWith("DATABASE_URL"))).toBe(true);
    expect(problems.some((p) => p.startsWith("APP_URL"))).toBe(true);
  });

  it("rejects a database URL that is not MongoDB", () => {
    expect(problemsOf({ ...valid, DATABASE_URL: "postgres://localhost/db" })[0]).toContain("DATABASE_URL");
  });

  it("requires an API key only when the YouTube API is enabled", () => {
    expect(problemsOf({ ...valid, YOUTUBE_API_ENABLED: "true" })[0]).toContain("YOUTUBE_API_KEY");
    expect(problemsOf({ ...valid, YOUTUBE_API_ENABLED: "true", YOUTUBE_API_KEY: "key" })).toEqual([]);
    expect(problemsOf({ ...valid, YOUTUBE_API_ENABLED: "false" })).toEqual([]);
  });

  it("treats empty values from .env files as unset", () => {
    expect(problemsOf({ ...valid, YOUTUBE_API_ENABLED: "true", YOUTUBE_API_KEY: "   " })[0]).toContain("YOUTUBE_API_KEY");
  });

  it("requires every S3 setting when S3 storage is selected", () => {
    const problems = problemsOf({ ...valid, STORAGE_PROVIDER: "s3" });
    for (const key of ["STORAGE_BUCKET", "STORAGE_REGION", "STORAGE_ACCESS_KEY", "STORAGE_SECRET_KEY"]) {
      expect(problems.some((p) => p.startsWith(key))).toBe(true);
    }
  });

  it("requires authentication settings in production only", () => {
    expect(problemsOf(valid)).toEqual([]);
    const problems = problemsOf({ ...valid, NODE_ENV: "production" });
    for (const key of ["AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "NEXTAUTH_URL"]) {
      expect(problems.some((p) => p.startsWith(key))).toBe(true);
    }
    expect(problemsOf(production)).toEqual([]);
  });

  it("rejects short secrets", () => {
    expect(problemsOf({ ...production, AUTH_SECRET: "short" })[0]).toContain("AUTH_SECRET");
    expect(problemsOf({ ...valid, CRON_SECRET: "short" })[0]).toContain("CRON_SECRET");
  });

  it("rejects half of a Google OAuth pair in any environment", () => {
    expect(problemsOf({ ...valid, AUTH_GOOGLE_ID: "id" })[0]).toContain("AUTH_GOOGLE_SECRET");
  });

  it("never includes secret values in error messages", () => {
    const secret = "super-secret-value";
    try {
      parseEnv({ ...valid, DATABASE_URL: `postgres://user:${secret}@host/db`, CRON_SECRET: secret });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
