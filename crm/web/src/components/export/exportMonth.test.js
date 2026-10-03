import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ***************************************************
 * * CONTRACT: the export month is the one on the ADMIN'S clock
 * ***************************************************
 *
 * The modal derives the month rather than offering a picker, so if it
 * derives the wrong one there is nothing on screen to correct. It was UTC:
 * from 5pm Pacific on the last day of a month it named next month in the
 * tab and generated a file whose total read almost zero, which is
 * indistinguishable from a broken export.
 *
 * The API's half is `TIMEZONE` in `crm/api/v1/shared/presetMonth.helper.js`,
 * pinned by `businessMonth.test.js` there. This side reads the browser's own
 * zone; the two agree as long as that env var names the zone the admin is
 * in. NO IMPORT ACROSS THE BOUNDARY: this reads its own source text.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(here, 'MasterSheetExportModal.jsx'), 'utf8');

test('THE MODAL DOES NOT DERIVE THE MONTH IN UTC', () => {
  const fn = SOURCE.match(/function currentMonth\(\)[\s\S]*?\n}/)?.[0];
  assert.ok(fn, 'currentMonth has been renamed or removed');

  assert.doesNotMatch(fn, /getUTC|toISOString/, `still UTC:\n${fn}`);
  assert.match(fn, /getFullYear\(\)/);
  assert.match(fn, /getMonth\(\)/);
});

test('and it still produces YYYY-MM', () => {
  // Evaluated rather than eyeballed, because a padStart off by one gives
  // "2026-9" and every downstream comparison silently misses.
  // eslint-disable-next-line no-new-func
  const currentMonth = new Function(`${SOURCE.match(/function currentMonth\(\)[\s\S]*?\n}/)[0]}; return currentMonth;`)();
  assert.match(currentMonth(), /^\d{4}-(0[1-9]|1[0-2])$/);
});
