import { describe, expect, it } from "vitest";
import { nextQuotaReset, pacificDay } from "./quota";

describe("nextQuotaReset", () => {
  it("is the next midnight in Los Angeles, in summer and in winter", () => {
    // 10:00 in Los Angeles on each date: 14 hours to go.
    expect(nextQuotaReset(new Date("2026-07-01T17:00:00Z")).toISOString()).toBe("2026-07-02T07:00:00.000Z");
    expect(nextQuotaReset(new Date("2026-12-01T18:00:00Z")).toISOString()).toBe("2026-12-02T08:00:00.000Z");
  });

  it("lands on the start of the next Pacific day", () => {
    const now = new Date("2026-11-08T11:45:00Z");
    const reset = nextQuotaReset(now);
    expect(pacificDay(reset)).not.toBe(pacificDay(now));
    expect(pacificDay(new Date(reset.getTime() - 1000))).toBe(pacificDay(now));
  });
});
