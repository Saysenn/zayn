import { describe, expect, it } from "vitest";
import { jobIdOf } from "./jobId.js";

describe("jobIdOf", () => {
  it("never emits a colon — BullMQ rejects the whole job if it does", () => {
    expect(jobIdOf("payday", "2026-08", "MILKMAN", "nathan")).not.toContain(
      ":",
    );
    expect(jobIdOf("3EB0:C767:8A5F")).not.toContain(":");
  });

  it("joins the parts with dashes", () => {
    expect(jobIdOf("payday", "2026-08", "MILKMAN", "nathan")).toBe(
      "payday-2026-08-MILKMAN-nathan",
    );
  });

  /** the whole point of the thing: same person, same period, same ID */
  it("is stable for the same inputs", () => {
    expect(jobIdOf("payday", "2026-08", "MILKMAN", "nathan")).toBe(
      jobIdOf("payday", "2026-08", "MILKMAN", "nathan"),
    );
  });

  it("keeps different people and different periods apart", () => {
    expect(jobIdOf("payday", "2026-08", "MILKMAN", "nathan")).not.toBe(
      jobIdOf("payday", "2026-09", "MILKMAN", "nathan"),
    );
    expect(jobIdOf("payday", "2026-08", "MILKMAN", "nathan")).not.toBe(
      jobIdOf("payday", "2026-08", "MILKMAN", "natalie"),
    );
  });
});
