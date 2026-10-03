import { readdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { features } from "../config/index.js";
import { tools } from "./index.js";
import { schemaOf } from "./shared/defineTool.js";

/**
 * THE COMPANY LIST IS STUBBED, and this file is the reason it has to be.
 *
 * Three tools build their schema from `companiesInScope`, which reads the
 * master sheet: Redis first, the CRM behind it. With neither reachable the
 * call retries until the 5s timeout, so the one test that walks every
 * schema failed on a machine with no infrastructure rather than on a fault.
 *
 * A schema's SHAPE is static. What it must never accept does not depend on
 * which companies exist, so the real read earns nothing here.
 */
vi.mock("../employee/access.js", () => ({
  companiesInScope: async () => ["Workforce", "Relia PA"],
  readable: async () => [],
  resolveScope: () => new Set(),
  matchCompany: () => undefined,
  identify: async () => undefined,
  groupsOf: () => [],
}));

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * A tool that exists but is never offered to the model is the failure this
 * whole file guards. It works perfectly, nothing fails, and nobody can use it.
 */
describe("every tool file is loaded", () => {
  it("finds one tool per file in this folder", async () => {
    const entries = await readdir(HERE, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && /^my|^shared/.test(e.name) === false)
      .map((e) => e.name)
      .filter(
        (n) => /\.ts$/.test(n) && !/\.test\.ts$/.test(n) && n !== "index.ts",
      );

    // whatever is in the folder, the loader found at least that many tools
    expect(tools.length).toBeGreaterThanOrEqual(files.length);
  });

  it("has the six that are always on", () => {
    // get_my_breakdown_file is not here: it needs FEATURE_DOCUMENTS, so whether
    // it loads depends on the environment. Its own test covers that.
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "count_my_companies",
        "get_my_breakdown",
        "get_my_company",
        "get_my_dates",
        "get_my_total",
        "rank_my_companies",
        ...(features.documents ? ["get_my_breakdown_file"] : []),
      ].sort(),
    );
  });

  it("loads the file tool only when documents are switched on", () => {
    const loaded = tools.some((t) => t.name === "get_my_breakdown_file");
    expect(loaded).toBe(features.documents);
  });

  it("loads them in the same order every time", () => {
    const names = tools.map((t) => t.name);
    expect([...names]).toEqual(names); // sorted by filename, so stable across boots
  });
});

describe("every tool is usable by the model", () => {
  it("has a name, a description and a schema", () => {
    for (const t of tools) {
      expect(t.name, "tool name").toMatch(/^[a-z][a-z0-9_]*$/);
      expect(t.description.length, `${t.name} description`).toBeGreaterThan(30);
      expect(t.schema, `${t.name} schema`).toBeDefined();
      expect(typeof t.handler, `${t.name} handler`).toBe("function");
    }
  });

  it("never takes an identity or a group argument", async () => {
    const ctx = {
      person: {
        personId: "p1",
        personName: "Test",
        phone: "",
        assignments: [],
      },
      channelGroup: "MILKMAN",
      scope: new Set(["p1"]),
    };

    for (const t of tools) {
      const schema = await schemaOf(t, ctx);
      const keys = Object.keys(schema.shape ?? {});
      // whose rows and which group come from ctx. If the LLM could pass them,
      // it could pass somebody else's
      for (const banned of [
        "personId",
        "person",
        "who",
        "group",
        "employee",
        "name",
      ]) {
        expect(keys, `${t.name} must not accept "${banned}"`).not.toContain(
          banned,
        );
      }
    }
  });
});
