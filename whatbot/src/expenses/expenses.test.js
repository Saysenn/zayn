import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CRM_DOWN,
  expenseTurn,
  isExpenseAdmin,
  mediaOf,
  resetAdminCache,
} from "./expenses.js";
import { crmConfig } from "../config/index.js";

/**
 * The guard and the messenger. The brain itself is the CRM's and tested there
 * (crm/api/v1/expenses/bot/bot.test.js).
 */

const ADMINS = { admins: [{ phone: "+447700900001", group: "MANBAT" }] };

beforeEach(() => {
  resetAdminCache();
  crmConfig.apiUrl = "http://crm.test";
  crmConfig.apiKey = "test-key";
});
afterEach(() => vi.unstubAllGlobals());

describe("the guard: a registered admin on THIS group's number only", () => {
  it("lets the admin in on their group, nobody else, and no other group", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ADMINS })));
    expect(await isExpenseAdmin("+447700900001", "MANBAT")).toBe(true);
    expect(await isExpenseAdmin("+447700900001", "manbat")).toBe(true);
    expect(await isExpenseAdmin("+447700900001", "INDIGO")).toBe(false);
    expect(await isExpenseAdmin("+447700900999", "MANBAT")).toBe(false);
  });

  it("asks the CRM once a minute, not on every message", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ADMINS }));
    vi.stubGlobal("fetch", fetch);
    await isExpenseAdmin("+447700900001", "MANBAT");
    await isExpenseAdmin("+447700900001", "MANBAT");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("a CRM it cannot reach opens no door", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await isExpenseAdmin("+447700900001", "MANBAT")).toBe(false);
  });
});

describe("media: a receipt photo or a file, with its caption", () => {
  it("reads photos, files and files with captions; nothing else", () => {
    expect(mediaOf({ imageMessage: { mimetype: "image/jpeg", caption: " lunch " } })).toMatchObject({ kind: "image", caption: "lunch" });
    expect(mediaOf({ documentMessage: { mimetype: "application/pdf", fileName: "r.pdf" } })).toMatchObject({ kind: "document", filename: "r.pdf" });
    expect(mediaOf({ documentWithCaptionMessage: { message: { documentMessage: { fileName: "x.xlsx", caption: "october" } } } })).toMatchObject({ filename: "x.xlsx", caption: "october" });
    expect(mediaOf({ conversation: "hi" })).toBeNull();
    expect(mediaOf({ stickerMessage: {} })).toBeNull();
  });
});

describe("the turn: one message to the CRM, one reply back", () => {
  it("passes the dedupe key and returns the CRM's reply", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ registered: true, reply: "✅ *Saved 1 expense*" }) }));
    vi.stubGlobal("fetch", fetch);
    const out = await expenseTurn({ phone: "+447700900001", group: "MANBAT", text: "yes", messageId: "m1" });
    expect(out.reply).toBe("✅ *Saved 1 expense*");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ phone: "+447700900001", group: "MANBAT", messageId: "m1" });
  });

  it("an unreachable or broken CRM says nothing was saved, never silence", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect((await expenseTurn({ phone: "+1", group: "MANBAT", text: "x" })).reply).toBe(CRM_DOWN);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ nonsense: 1 }) })));
    expect((await expenseTurn({ phone: "+1", group: "MANBAT", text: "x" })).reply).toBe(CRM_DOWN);
  });

  it("not registered after all: handed back for the old path", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ registered: false }) })));
    expect((await expenseTurn({ phone: "+1", group: "MANBAT", text: "x" })).registered).toBe(false);
  });
});

describe("a file the bot will not read is answered at once", () => {
  it("knows what it can read, and says what it can", async () => {
    const { readable, unreadableReply } = await import("./expenses.js");
    expect(readable({ kind: "image", filename: "photo.jpg", mime: "image/jpeg" })).toBe(true);
    expect(readable({ kind: "document", filename: "October.xlsx", mime: "application/octet-stream" })).toBe(true);
    expect(readable({ kind: "document", filename: "clip.mp4", mime: "video/mp4" })).toBe(false);
    expect(unreadableReply({ filename: "clip.mp4", why: "type" })).toMatch(/can't read \*clip\.mp4\*.*photo, a PDF/);
    expect(unreadableReply({ filename: "big.pdf", why: "size" })).toMatch(/too big/);
  });
});
