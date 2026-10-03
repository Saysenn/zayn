const pool = require('../../configs/db');
const { DEFAULT_LOCAL_LOCATIONS } = require('../shared/awayLocations.helper');
const {
  DEFAULT_DASHBOARD_HISTORY, dashboardHistoryMonths,
} = require('../shared/snapshotWindow.helper');

// Always id=1 — see migrations/009_settings_and_logs.sql. One row, no query param.
function get() {
  return pool
    .query(`SELECT dev_mode, whatbot_writes_enabled, local_locations, color_uses_end_date,
                   crypto_percent, dashboard_history_months, updated_at
              FROM tb_settings WHERE id = 1`)
    .then(
      (result) =>
        result.rows[0] ?? {
          dev_mode: false,
          whatbot_writes_enabled: true,
          local_locations: DEFAULT_LOCAL_LOCATIONS,
          color_uses_end_date: false,
          crypto_percent: 1,
          dashboard_history_months: DEFAULT_DASHBOARD_HISTORY,
          updated_at: null,
        },
    );
}

/**
 * ===============================
 * * HOW HE LIKES THE MASTER SHEET EXPORT TAB
 * ===============================
 * One screen's own settings: its colour and which switches start on. NULL
 * means he has never set it up, which is a real third state apart from
 * "set back to the defaults": the modal falls back either way, and the
 * difference is only whether the panel opens on his choices.
 *
 * STORED WHOLE, never merged. The panel sends the settings it holds, so a
 * partial write would leave a half state nobody chose. See migration 063.
 *
 * READ ON ITS OWN, NEVER FROM get(). It was added to that SELECT and every
 * page that loads settings 500'd on a database without migration 063,
 * which is a login screen broken by a column one modal wanted. The banner
 * above get() says exactly this about the briefing flag; I added the
 * column anyway. Found 2026-09-22, reference d56675.
 */
function exportTabStyle() {
  return pool
    .query('SELECT export_tab_style FROM tb_settings WHERE id = 1')
    .then((result) => result.rows[0]?.export_tab_style ?? null)
    .catch(() => null);
}

function setExportTabStyle(style) {
  return pool
    .query(
      `UPDATE tb_settings SET export_tab_style = $1::jsonb, updated_at = now()
        WHERE id = 1 RETURNING export_tab_style`,
      [style === null ? null : JSON.stringify(style)],
    )
    .then((res) => res.rows[0]?.export_tab_style ?? null);
}

/**
 * Where the business is. Everything else is money leaving the country.
 *
 * Read on its own by the export, which needs the list and nothing else
 * from settings, and falls back rather than throwing: a payout file
 * refusing to generate because a settings row is missing is worse than one
 * using the default the column itself carries.
 */
function localLocations() {
  return pool
    .query('SELECT local_locations FROM tb_settings WHERE id = 1')
    .then((result) => result.rows[0]?.local_locations ?? DEFAULT_LOCAL_LOCATIONS)
    .catch(() => DEFAULT_LOCAL_LOCATIONS);
}

function setLocalLocations(list) {
  return pool
    .query(
      'UPDATE tb_settings SET local_locations = $1, updated_at = now() WHERE id = 1 RETURNING local_locations',
      [list],
    )
    .then((result) => result.rows[0]?.local_locations ?? []);
}

function setDevMode(devMode) {
  return pool
    .query(
      'UPDATE tb_settings SET dev_mode = $1, updated_at = now() WHERE id = 1 RETURNING dev_mode, whatbot_writes_enabled, updated_at',
      [devMode],
    )
    .then((result) => result.rows[0]);
}

/**
 * Turns whatbot's payday write on or off without a deploy.
 *
 * Checked by PATCH /api/v1/agent/payment-status on every call rather than
 * cached — an admin turning this off mid-payday means it stops now, not
 * whenever a cache happens to expire.
 */
function setWhatbotWrites(enabled) {
  return pool
    .query(
      'UPDATE tb_settings SET whatbot_writes_enabled = $1, updated_at = now() WHERE id = 1 RETURNING dev_mode, whatbot_writes_enabled, updated_at',
      [enabled],
    )
    .then((result) => result.rows[0]);
}

/**
 * ===============================
 * * READ ON ITS OWN, NOT IN get()
 * ===============================
 * `get()` is read on nearly every request path: exports, totals, the
 * review queue, Diane. Putting a new column in its SELECT means a deploy
 * that forgets one migration takes ALL of that down rather than one
 * optional feature.
 *
 * So this asks for the column by itself, and an undefined_column (42703)
 * means migration 060 has not run yet: the briefing behaves as ON, which
 * is its default, and nothing else notices. Only that one code is caught;
 * a real database error still throws.
 */
async function loginBriefing() {
  try {
    const { rows } = await pool.query('SELECT login_briefing FROM tb_settings WHERE id = 1');
    return rows[0]?.login_briefing !== false;
  } catch (err) {
    if (err?.code === '42703') return true;
    throw err;
  }
}

function setLoginBriefing(on) {
  return pool
    .query(
      'UPDATE tb_settings SET login_briefing = $1, updated_at = now() WHERE id = 1 RETURNING login_briefing',
      [Boolean(on)],
    )
    .then((res) => res.rows[0]?.login_briefing ?? true);
}

/**
 * ===============================
 * * AUTO MODE, read on its own like the briefing above
 * ===============================
 * Same doctrine, same 42703 tolerance: a deploy that has not run migration
 * 068 behaves as OFF, which is the default, and nothing else notices.
 *
 * THE FALLBACK IS THE SAFE HALF, not the convenient one. A missing column
 * must never mean "skip the confirmation": unreadable is not permission.
 */
async function agentAutoConfirm() {
  try {
    const { rows } = await pool.query('SELECT agent_auto_confirm FROM tb_settings WHERE id = 1');
    return rows[0]?.agent_auto_confirm === true;
  } catch (err) {
    if (err?.code === '42703') return false;
    throw err;
  }
}

function setAgentAutoConfirm(on) {
  return pool
    .query(
      `UPDATE tb_settings SET agent_auto_confirm = $1, updated_at = now()
        WHERE id = 1 RETURNING agent_auto_confirm`,
      [Boolean(on)],
    )
    .then((res) => res.rows[0]?.agent_auto_confirm === true);
}

function setColorUsesEndDate(on) {
  return pool
    .query(
      'UPDATE tb_settings SET color_uses_end_date = $1, updated_at = now() WHERE id = 1 RETURNING color_uses_end_date',
      [Boolean(on)],
    )
    .then((res) => res.rows[0]?.color_uses_end_date ?? false);
}

// ===============================
// * What a crypto payment costs us in gas
// ===============================
// Read on its own by the export. Falls back to the column default rather
// than throwing: a payout file refusing to generate over a missing
// settings row is worse than one built on the rate the schema carries.
const CRYPTO_DEFAULT = 1;

function cryptoPercent() {
  return pool
    .query('SELECT crypto_percent FROM tb_settings WHERE id = 1')
    .then((result) => Number(result.rows[0]?.crypto_percent ?? CRYPTO_DEFAULT))
    .catch(() => CRYPTO_DEFAULT);
}

function setCryptoPercent(percent) {
  return pool
    .query(
      'UPDATE tb_settings SET crypto_percent = $1::numeric, updated_at = now() WHERE id = 1 RETURNING crypto_percent',
      [percent],
    )
    .then((res) => Number(res.rows[0]?.crypto_percent ?? CRYPTO_DEFAULT));
}

/**
 * HOW FAR BACK THE DASHBOARD OFFERS, and nothing else.
 *
 * It does not touch retention: the scheduler keeps SNAPSHOT_MONTHS whatever
 * this says. That separation is deliberate and it is what makes raising
 * this free, since the months were never deleted. See
 * shared/snapshotWindow.helper.js.
 *
 * The value is folded to a known one rather than trusted, so a row edited
 * by hand cannot leave the range dropdown with nothing to select.
 */
function setDashboardHistoryMonths(months) {
  return pool
    .query(
      `UPDATE tb_settings SET dashboard_history_months = $1, updated_at = now()
        WHERE id = 1 RETURNING dashboard_history_months`,
      [dashboardHistoryMonths(months)],
    )
    .then((res) => dashboardHistoryMonths(res.rows[0]?.dashboard_history_months));
}

module.exports = {
  get, setDevMode, setWhatbotWrites, localLocations, setLocalLocations, setColorUsesEndDate,
  loginBriefing, setLoginBriefing,
  agentAutoConfirm, setAgentAutoConfirm,
  cryptoPercent, setCryptoPercent, CRYPTO_DEFAULT,
  setDashboardHistoryMonths, DEFAULT_DASHBOARD_HISTORY,
  exportTabStyle, setExportTabStyle,
};
