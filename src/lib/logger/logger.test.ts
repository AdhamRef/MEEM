import { afterEach, describe, expect, it, vi } from "vitest";
import { logger, redact } from "./index";

afterEach(() => vi.restoreAllMocks());

describe("redact", () => {
  it("hides values under secret-looking keys, at any depth", () => {
    expect(
      redact({
        apiKey: "a",
        AUTH_SECRET: "b",
        nested: { accessToken: "c", list: [{ password: "d", safe: "e" }] },
        DATABASE_URL: "f",
      }),
    ).toEqual({
      apiKey: "[redacted]",
      AUTH_SECRET: "[redacted]",
      nested: { accessToken: "[redacted]", list: [{ password: "[redacted]", safe: "e" }] },
      DATABASE_URL: "[redacted]",
    });
  });

  it("hides credentials inside strings", () => {
    expect(redact("mongodb+srv://user:pass@host/db")).toBe("mongodb+srv://[redacted]@host/db");
    expect(redact("https://www.googleapis.com/youtube/v3/videos?id=abc&key=SECRET&part=id")).toBe(
      "https://www.googleapis.com/youtube/v3/videos?id=abc&key=[redacted]&part=id",
    );
  });

  it("does not mistake ordinary text for credentials", () => {
    expect(redact("نص عربي عادي")).toBe("نص عربي عادي");
    expect(redact("https://example.com/a?monkey=1")).toBe("https://example.com/a?monkey=1");
  });

  it("redacts error messages and stacks", () => {
    const result = redact(new Error("failed: mongodb://user:pass@host/db")) as { message: string; stack: string };
    expect(result.message).not.toContain("pass");
    expect(result.stack).not.toContain("user:pass");
  });

  it("stops at a safe depth instead of overflowing on deep objects", () => {
    let deep: Record<string, unknown> = { value: 1 };
    for (let i = 0; i < 20; i++) deep = { deep };
    expect(JSON.stringify(redact(deep))).toContain("[truncated]");
  });
});

describe("logger", () => {
  it("writes one JSON line to the stream matching its level", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    logger.error("failed", { token: "abc", videoId: "xyz" });
    logger.info("started");

    const entry = JSON.parse(String(error.mock.calls[0]?.[0]));
    expect(entry).toMatchObject({ level: "error", message: "failed", context: { token: "[redacted]", videoId: "xyz" } });
    expect(new Date(entry.time).getTime()).not.toBeNaN();
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).not.toHaveProperty("context");
  });
});
