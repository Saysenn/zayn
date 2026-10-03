import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The outbox exists for one failure: the CRM is down when somebody says
 * their wages did not arrive, the push is fire-and-forget, and without a
 * record of the failure that outcome is lost with nothing logged. So these
 * tests are all about the flag, not about HTTP.
 */

const recordPaymentStatus = vi.fn();
const crmConfigured = vi.fn(() => true);
const markCrmSynced = vi.fn();
const unsyncedRecords = vi.fn();
const findAll = vi.fn(async () => []);
const personFrom = vi.fn();

vi.mock("../system/crmClient.js", () => ({
  recordPaymentStatus: (...a) => recordPaymentStatus(...a),
  crmConfigured: (...a) => crmConfigured(...a),
}));
vi.mock("./records.js", () => ({
  markCrmSynced: (...a) => markCrmSynced(...a),
  unsyncedRecords: (...a) => unsyncedRecords(...a),
}));
vi.mock("../employee/storage.js", () => ({
  findAll: (...a) => findAll(...a),
  personFrom: (...a) => personFrom(...a),
}));

const { pushOutcome, retryUnsynced } = await import("./crmOutbox.js");

const person = { personId: "nathan", assignments: [] };

beforeEach(() => {
  vi.clearAllMocks();
  crmConfigured.mockReturnValue(true);
});

describe("pushOutcome", () => {
  it("marks the record synced when every assignment lands", async () => {
    recordPaymentStatus.mockResolvedValue([{ ok: true }, { ok: true }]);

    await expect(
      pushOutcome(person, "MILKMAN", "2026-08", "confirmed"),
    ).resolves.toBe(true);
    expect(markCrmSynced).toHaveBeenCalledWith(
      "2026-08",
      "MILKMAN",
      "nathan",
      "confirmed",
    );
  });

  /**
   * request() answers null for every failure. One null means the CRM does
   * not have the full picture, so the record stays unsynced and the sweep
   * tries again — a half-delivered outcome is not a delivered one.
   */
  it("leaves it unsynced when any assignment fails", async () => {
    recordPaymentStatus.mockResolvedValue([{ ok: true }, null]);

    await expect(
      pushOutcome(person, "MILKMAN", "2026-08", "not_received", "nothing came"),
    ).resolves.toBe(false);
    expect(markCrmSynced).not.toHaveBeenCalled();
  });

  it("treats a person with nothing in this group as done, not as failed", async () => {
    recordPaymentStatus.mockResolvedValue([]);

    await expect(
      pushOutcome(person, "INDIGO", "2026-08", "sent"),
    ).resolves.toBe(true);
  });
});

describe("retryUnsynced", () => {
  it("does nothing at all when no CRM is configured", async () => {
    crmConfigured.mockReturnValue(false);

    await expect(retryUnsynced("2026-08")).resolves.toEqual({
      pending: 0,
      pushed: 0,
      failed: 0,
    });
    expect(unsyncedRecords).not.toHaveBeenCalled();
  });

  it("pushes what is pending and reports what landed", async () => {
    unsyncedRecords.mockResolvedValue([
      { personId: "nathan", group: "MILKMAN", outcome: "partial", note: "half" },
    ]);
    personFrom.mockReturnValue(person);
    recordPaymentStatus.mockResolvedValue([{ ok: true }]);

    await expect(retryUnsynced("2026-08")).resolves.toEqual({
      pending: 1,
      pushed: 1,
      failed: 0,
    });
    expect(recordPaymentStatus).toHaveBeenCalledWith(
      person,
      "MILKMAN",
      "2026-08",
      "partial",
      "half",
    );
  });

  // They left, or the sheet dropped them. There is no assignment left in the
  // CRM for this outcome to attach to, so retrying it every five minutes
  // forever would be noise, not persistence.
  it("gives up on a record whose person is no longer on the roster", async () => {
    unsyncedRecords.mockResolvedValue([
      { personId: "ghost", group: "MILKMAN", outcome: "confirmed" },
    ]);
    personFrom.mockReturnValue(null);

    await expect(retryUnsynced("2026-08")).resolves.toEqual({
      pending: 1,
      pushed: 0,
      failed: 1,
    });
    expect(recordPaymentStatus).not.toHaveBeenCalled();
  });
});
