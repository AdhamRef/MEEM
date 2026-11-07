import { describe, expect, it } from "vitest";
import { isChannelOn, isOnByDefault, mergeChannelChoices, withChannelSwitched } from "./channel-choices";

const selected = (...ids: string[]) => new Set(ids);

describe("isOnByDefault", () => {
  it("turns everything on until someone has chosen a topic", () => {
    expect(isOnByDefault(["a"], selected())).toBe(true);
    expect(isOnByDefault([], selected())).toBe(true);
  });

  it("turns on only channels sharing a chosen topic", () => {
    expect(isOnByDefault(["a", "b"], selected("b"))).toBe(true);
    expect(isOnByDefault(["a"], selected("b"))).toBe(false);
  });

  it("leaves a channel with no topics off once topics are chosen", () => {
    expect(isOnByDefault([], selected("b"))).toBe(false);
  });
});

describe("isChannelOn", () => {
  it("lets a switch beat the default in both directions", () => {
    expect(isChannelOn("x", ["a"], selected("a"), { x: false })).toBe(false);
    expect(isChannelOn("x", ["a"], selected("b"), { x: true })).toBe(true);
  });

  it("follows topics when there's no switch", () => {
    expect(isChannelOn("x", ["a"], selected("a"), { y: false })).toBe(true);
    expect(isChannelOn("x", ["a"], selected("b"), {})).toBe(false);
  });
});

describe("withChannelSwitched", () => {
  it("stores a difference from the default", () => {
    expect(withChannelSwitched({}, "x", false, true)).toEqual({ x: false });
    expect(withChannelSwitched({}, "x", true, false)).toEqual({ x: true });
  });

  it("forgets a switch that returns to the default, so the channel follows topics again", () => {
    expect(withChannelSwitched({ x: false }, "x", true, true)).toEqual({});
  });

  it("doesn't change the original", () => {
    const original = { x: false };
    withChannelSwitched(original, "y", false, true);
    expect(original).toEqual({ x: false });
  });
});

describe("mergeChannelChoices", () => {
  const known = selected("a", "b", "c");

  it("keeps the account's choice where both decided", () => {
    expect(mergeChannelChoices({ a: true }, { a: false, b: false }, known)).toEqual({ a: true, b: false });
  });

  it("drops channels that no longer exist, since browser data can be old", () => {
    expect(mergeChannelChoices({}, { gone: true, c: true }, known)).toEqual({ c: true });
  });
});
