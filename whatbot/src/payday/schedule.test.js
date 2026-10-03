import { describe, expect, it } from "vitest";
import { isLastFridayOfMonth, PAYDAY_CRON } from "./schedule.js";

/** UTC noon, so no test ever depends on where the machine is */
const at = (iso) => new Date(`${iso}T12:00:00Z`);

describe("isLastFridayOfMonth", () => {
  it("is true on the last Friday", () => {
    expect(isLastFridayOfMonth(at("2026-08-28"))).toBe(true);
    expect(isLastFridayOfMonth(at("2026-09-25"))).toBe(true);
    expect(isLastFridayOfMonth(at("2026-10-30"))).toBe(true);
  });

  it("is false on every earlier Friday", () => {
    for (const d of ["2026-08-07", "2026-08-14", "2026-08-21"]) {
      expect(isLastFridayOfMonth(at(d))).toBe(false);
    }
  });

  it("is false on any other day, including the last of the month", () => {
    expect(isLastFridayOfMonth(at("2026-08-31"))).toBe(false); // Monday
    expect(isLastFridayOfMonth(at("2026-08-29"))).toBe(false); // Saturday
    expect(isLastFridayOfMonth(at("2026-08-27"))).toBe(false); // Thursday
  });

  /**
   * A five-Friday month is where an off-by-one shows up: the fourth Friday
   * looks like the last one if you count weeks instead of checking the date.
   */
  it("picks the fifth Friday when there is one", () => {
    expect(isLastFridayOfMonth(at("2026-01-30"))).toBe(true);
    expect(isLastFridayOfMonth(at("2026-01-23"))).toBe(false);
  });

  it("handles February, leap and otherwise", () => {
    expect(isLastFridayOfMonth(at("2026-02-27"))).toBe(true);
    // 2028 is a leap year: 29 Feb is a Tuesday, so the last Friday is the 25th
    expect(isLastFridayOfMonth(at("2028-02-25"))).toBe(true);
    expect(isLastFridayOfMonth(at("2028-02-18"))).toBe(false);
  });

  it("handles a December that rolls the year", () => {
    expect(isLastFridayOfMonth(at("2026-12-25"))).toBe(true);
    expect(isLastFridayOfMonth(at("2026-12-18"))).toBe(false);
  });

  /** exactly one per month, never two, never none */
  it("finds one last Friday in every month of a year", () => {
    for (let month = 0; month < 12; month++) {
      const hits = [];
      for (let day = 1; day <= 31; day++) {
        const d = new Date(Date.UTC(2026, month, day, 12));
        if (d.getUTCMonth() !== month) break;
        if (isLastFridayOfMonth(d)) hits.push(day);
      }
      expect(hits).toHaveLength(1);
    }
  });
});

describe("PAYDAY_CRON", () => {
  it("fires Fridays at 16:00, not 09:00", () => {
    // the afternoon is the point — see schedule.ts
    expect(PAYDAY_CRON).toBe("0 16 * * 5");
  });
});
