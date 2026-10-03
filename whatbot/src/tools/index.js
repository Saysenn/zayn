import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { featureEnabled } from "../config/index.js";
import { logger } from "../system/logger.js";

/**
 * The menu the LLM gets to pick from — every tool file in this folder.
 *
 * Drop a file in `tools/`, export a `defineTool(...)`, and it is live. There is
 * no list to remember to add yourself to, which is the failure this replaces:
 * a tool that works perfectly and is never offered to the model, with nothing
 * failing anywhere to tell you.
 *
 * One tool per SHAPE of answer, so each returns exactly what was asked and
 * nothing more:
 *   get_my_breakdown     every company and what each pays
 *   get_my_company       one company I named
 *   get_my_total         one figure
 *   count_my_companies   how many, and which
 *   rank_my_companies    ordered by amount, optionally the top few
 *   get_my_dates         when each one started and when it ends, no amounts
 *
 * Narrow tools rather than one broad tool with an `aggregate` argument. A small
 * model picks reliably between differently-named tools and unreliably between
 * arguments to the same one — when it forgot the argument, "what's my total"
 * came back as the whole list with the total buried at the bottom.
 *
 * Every one is already scoped twice before it runs — to this caller, and to the
 * group whose number they messaged. Neither is something the LLM can pass in,
 * and that is enforced in `employee/access.ts`, not here. A new tool inherits
 * it by taking `ctx` and asking `access` for rows; it cannot opt out.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** does this export look like a tool, rather than a helper that came with it? */
function isTool(value) {
  if (typeof value !== "object" || value === null) return false;
  const t = value;
  return (
    typeof t.name === "string" &&
    typeof t.description === "string" &&
    typeof t.handler === "function" &&
    t.schema !== undefined
  );
}

/**
 * Read the folder, import every tool file, keep what looks like a tool.
 *
 * Sorted by filename so the order the model sees is the same on every boot.
 * Two tools claiming one name is a programming mistake and throws — the second
 * would silently shadow the first, and which one you got would depend on the
 * filesystem.
 */
async function loadTools() {
  const entries = await readdir(HERE, { withFileTypes: true });

  const files = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => /\.(ts|js)$/.test(name))
    .filter((name) => !name.endsWith(".d.ts"))
    .filter((name) => !/\.test\.(ts|js)$/.test(name))
    .filter((name) => !/^index\.(ts|js)$/.test(name))
    .sort();

  const found = [];
  const seen = new Map();

  for (const file of files) {
    // pathToFileURL, not the bare path. On Windows `join` gives
    // `V:\whatbot\src\tools\x.ts`, and Node's ESM loader reads the drive letter
    // as a URL scheme — ERR_UNSUPPORTED_ESM_URL_SCHEME, "Received protocol 'v:'".
    // A POSIX path happens to work by accident; this works everywhere.
    const module = await import(pathToFileURL(join(HERE, file)).href);

    for (const value of Object.values(module)) {
      if (!isTool(value)) continue;

      const clash = seen.get(value.name);
      if (clash) {
        throw new Error(
          `two tools are both called "${value.name}" (${clash} and ${file}). Tool names are what the model picks by, so they have to be unique.`,
        );
      }
      seen.set(value.name, file);

      // A tool behind a switched-off feature is not loaded at all, so the model
      // never learns the name. Dropping the RESULT instead would leave it free
      // to promise a file in prose that never arrives.
      if (value.requires && !featureEnabled(value.requires)) {
        logger.info(
          { tool: value.name, feature: value.requires },
          "tool off — feature disabled",
        );
        continue;
      }

      found.push(value);
    }
  }

  if (found.length === 0) {
    throw new Error(
      `no tools found in ${HERE} — the agent would have nothing to answer with`,
    );
  }

  logger.info({ tools: found.map((t) => t.name) }, "tools loaded");
  return found;
}

/**
 * Loaded once, at import.
 *
 * Top-level await so everything downstream keeps a plain array and none of the
 * call sites have to know this is read off disk.
 */
export const tools = await loadTools();
