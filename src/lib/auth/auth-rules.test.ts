import { describe, expect, it } from "vitest";
import { safeCallbackPath, signInHref } from "./callback-url";
import { isSignInAllowed } from "./sign-in-policy";

describe("safeCallbackPath", () => {
  it.each(["/", "/interests", "/admin", "/topics/العقيدة", "/search?q=x"])("accepts the same-site path %s", (path) => {
    expect(safeCallbackPath(path)).toBe(path);
  });

  it.each([
    ["an absolute URL", "https://evil.example"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash trick", "/\\evil.example"],
    ["a tab browsers strip", "/\t/evil.example"],
    ["a newline browsers strip", "/\n/evil.example"],
    ["a javascript URL", "javascript:alert(1)"],
    ["no leading slash", "interests"],
    ["the sign-in page, which would loop", "/auth/signin"],
    ["the sign-in page with a query", "/auth/signin?error=x"],
    ["nothing", null],
    ["undefined", undefined],
    ["an empty string", ""],
  ])("falls back to home for %s", (_name, value) => {
    expect(safeCallbackPath(value)).toBe("/");
  });
});

describe("signInHref", () => {
  it("encodes the page to return to", () => {
    expect(signInHref("/admin")).toBe("/auth/signin?callbackUrl=%2Fadmin");
  });

  it("stays clean for home and unsafe paths", () => {
    expect(signInHref("/")).toBe("/auth/signin");
    expect(signInHref("//evil.example")).toBe("/auth/signin");
    expect(signInHref()).toBe("/auth/signin");
  });
});

describe("isSignInAllowed", () => {
  const verified = { email_verified: true };

  it("accepts a verified Google account", () => {
    expect(isSignInAllowed({ provider: "google", profile: verified, user: {} })).toBe(true);
    expect(isSignInAllowed({ provider: "google", profile: verified, user: { isDeactivated: false } })).toBe(true);
  });

  it("refuses an unverified Google email, since accounts are matched by email", () => {
    expect(isSignInAllowed({ provider: "google", profile: { email_verified: false }, user: {} })).toBe(false);
    expect(isSignInAllowed({ provider: "google", profile: {}, user: {} })).toBe(false);
    expect(isSignInAllowed({ provider: "google", profile: undefined, user: {} })).toBe(false);
    expect(isSignInAllowed({ provider: "google", profile: { email_verified: "true" }, user: {} })).toBe(false);
  });

  it("refuses a deactivated person", () => {
    expect(isSignInAllowed({ provider: "google", profile: verified, user: { isDeactivated: true } })).toBe(false);
  });

  it("refuses any other provider", () => {
    expect(isSignInAllowed({ provider: "credentials", profile: verified, user: {} })).toBe(false);
    expect(isSignInAllowed({ provider: undefined, profile: verified, user: {} })).toBe(false);
  });
});
