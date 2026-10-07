import { describe, expect, it } from "vitest";
import { AssignmentSchema, currencyCode, phoneOf } from "./types.js";

describe("the master sheet's number, made a real one (the pay guard)", () => {
  it("reads the ways the sheet writes a number", () => {
    expect(phoneOf("+44 7700 900123")).toBe("+447700900123");
    expect(phoneOf("07700900123")).toBe("+447700900123");
    expect(phoneOf("0044 7700 900123")).toBe("+447700900123");
    expect(phoneOf("+971 50 123 4567")).toBe("+971501234567");
  });

  it("a note in the phone column is no number: the deal stays, nobody is recognised by it", () => {
    expect(phoneOf("Handled internally")).toBe("");
    const row = { ...{"assignmentId": "beta|northstar|director|-|alexexample", "personId": "alexexample", "personName": "Alex Example", "phone": "", "role": "admin", "seat": null, "roleLabel": "Admin", "group": "BETA", "company": "Northstar Care", "assignedOn": "2025-01-01", "paymentStartOn": "2025-04-01", "presetOn": "2026-10-01", "endOn": null, "payableDays": 31, "monthlyAmount": 500, "payableAmount": 500, "currency": "GBP", "paymentMethod": "cash", "location": "", "postcode": "", "label": "", "shouldBePaid": "", "paid": "", "notes": "", "bankDetails": "", "status": "active", "needsReview": false, "reviewReason": ""}, phone: "Through nathan", currency: "EURO" };
    const parsed = AssignmentSchema.safeParse(row);
    expect(parsed.success).toBe(true);
    expect(parsed.data.phone).toBe("");
    expect(parsed.data.currency).toBe("EUR");
  });

  it("EURO is EUR", () => {
    expect(currencyCode("EURO")).toBe("EUR");
    expect(currencyCode("gbp")).toBe("GBP");
  });
});
