import { describe, expect, it } from "vitest";
import { isDestinationActive, navigationDestinations } from "./navigation";

describe("navigationDestinations", () => {
  it("has the five destinations from specification §5, in order", () => {
    expect(navigationDestinations.map((destination) => destination.href)).toEqual([
      "/",
      "/explore",
      "/topics",
      "/saved",
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

  it("does not match paths that merely share a prefix", () => {
    expect(isDestinationActive("/search", "/searching")).toBe(false);
  });
});
