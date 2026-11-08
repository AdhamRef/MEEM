import { describe, expect, it } from "vitest";
import { isDestinationActive, navigationDestinations } from "./navigation";

describe("navigationDestinations", () => {
  it("has the five destinations from specification §5, in order, with the library inside the account", () => {
    expect(navigationDestinations.map((destination) => destination.href)).toEqual([
      "/",
      "/explore",
      "/topics",
      "/account",
      "/search",
    ]);
  });
});

describe("isDestinationActive", () => {
  it("matches home only on the exact path", () => {
    expect(isDestinationActive("/", "/")).toBe(true);
    expect(isDestinationActive("/", "/explore")).toBe(false);
  });

  it("stays active on nested pages, including Arabic slugs", () => {
    expect(isDestinationActive("/topics", "/topics")).toBe(true);
    expect(isDestinationActive("/topics", "/topics/الصلاة")).toBe(true);
  });

  it("stays active on the pages a destination includes", () => {
    expect(isDestinationActive("/account", "/saved", ["/saved", "/history"])).toBe(true);
    expect(isDestinationActive("/account", "/history/x", ["/saved", "/history"])).toBe(true);
    expect(isDestinationActive("/account", "/explore", ["/saved", "/history"])).toBe(false);
  });

  it("does not match paths that merely share a prefix", () => {
    expect(isDestinationActive("/search", "/searching")).toBe(false);
  });
});
