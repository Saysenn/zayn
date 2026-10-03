import pg from "pg";
import { env } from "../config/index.js";
import { logger } from "./logger.js";

let pool = null;
let ready = null;

function getPool() {
  pool ??= new pg.Pool({ connectionString: env.DATABASE_URL, max: 4 });
  return pool;
}

/**
 * Made on first use instead of with a migration.
 *
 * This table stands alone — no foreign keys, nothing depends on it — and it has
 * to exist before the very first tool call regardless of what else has been
 * set up yet.
 */
async function ensureTable() {
  ready ??= (async () => {
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id          bigserial PRIMARY KEY,
        at          timestamptz NOT NULL,
        actor       text        NOT NULL,
        tool        text        NOT NULL,
        args        jsonb       NOT NULL,
        subjects    text[]      NOT NULL,
        flagged     text
      );
      CREATE INDEX IF NOT EXISTS audit_log_actor_at_idx ON audit_log (actor, at DESC);
      CREATE INDEX IF NOT EXISTS audit_log_subjects_idx ON audit_log USING gin (subjects);
    `);
    logger.info("audit_log table ready");
  })();

  return ready;
}

export const postgresAudit = {
  async write(entry) {
    await ensureTable();
    await getPool().query(
      `INSERT INTO audit_log (at, actor, tool, args, subjects, flagged)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        entry.at,
        entry.actor,
        entry.tool,
        JSON.stringify(entry.args),
        entry.subjects,
        entry.flagged ?? null,
      ],
    );
  },

  async recent(limit) {
    await ensureTable();
    const { rows } = await getPool().query(
      `SELECT at, actor, tool, args, subjects, flagged
       FROM audit_log ORDER BY at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({
      at: new Date(r.at).toISOString(),
      actor: r.actor,
      tool: r.tool,
      args: r.args,
      subjects: r.subjects,
      flagged: r.flagged ?? undefined,
    }));
  },
};
