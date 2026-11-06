import { describe, expect, it } from "vitest";
import { formatDuration, formatTimeAgo } from "./video-time";

describe("formatDuration", () => {
  it.each([
    [45, "0:45"],
    [725, "12:05"],
    [3723, "1:02:03"],
    [59.6, "1:00"],
  ])("formats %s seconds", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it("shows nothing when the length isn't known", () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(Number.NaN)).toBeNull();
  });
});

describe("formatTimeAgo", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  const expected = (value: number, unit: Intl.RelativeTimeFormatUnit) => new Intl.RelativeTimeFormat("ar", { numeric: "always" }).format(value, unit);

  it("uses the largest unit that fits", () => {
    expect(formatTimeAgo("2026-11-03T12:00:00Z", now)).toBe(expected(-3, "day"));
    expect(formatTimeAgo("2026-10-20T12:00:00Z", now)).toBe(expected(-2, "week"));
    expect(formatTimeAgo("2024-11-06T12:00:00Z", now)).toBe(expected(-2, "year"));
    expect(formatTimeAgo("2026-11-06T09:00:00Z", now)).toBe(expected(-3, "hour"));
  });

  it("never says something is in the future", () => {
    expect(formatTimeAgo("2027-01-01T00:00:00Z", now)).toBe(expected(-1, "minute"));
  });

  it("shows nothing without a real date", () => {
    expect(formatTimeAgo(null, now)).toBeNull();
    expect(formatTimeAgo("not a date", now)).toBeNull();
  });
});
