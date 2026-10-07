-- WHO SPENT IT, WHO SAVED IT, AND PEOPLE SEEING THEIR OWN. His calls
-- 2026-10-07.
--
-- saved_by: the admin who sent it in (WhatBot: their admin name; Diane or
--   the Expenses page: the signed-in username). Never asked, never typed.
-- spent_by_person_id: the master sheet person "spent by" is, set ONLY when
--   the name matches exactly one person (expenses/spender.js). An expense
--   without it is never shown to an employee on WhatsApp.
-- spent_by_phone: an admin who spent it and is not on the master sheet,
--   linked by their verified admin phone instead ("me").
ALTER TABLE tb_expenses
  ADD COLUMN IF NOT EXISTS saved_by text,
  ADD COLUMN IF NOT EXISTS spent_by_person_id text REFERENCES tb_people (person_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS spent_by_phone text;

CREATE INDEX IF NOT EXISTS tb_expenses_spent_by_person_idx ON tb_expenses (spent_by_person_id, spent_on DESC)
  WHERE spent_by_person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tb_expenses_spent_by_phone_idx ON tb_expenses (spent_by_phone, spent_on DESC)
  WHERE spent_by_phone IS NOT NULL;

-- People seeing their own expenses on WhatsApp (Settings → Whatbot). OFF
-- until he turns it on.
ALTER TABLE tb_settings
  ADD COLUMN IF NOT EXISTS whatbot_employee_expenses boolean NOT NULL DEFAULT false;

-- ===============================
-- * THE ONES ALREADY SAVED
-- ===============================
-- SAVED BY, from the bot's own record of what each admin added. Expenses
-- with no such record (imported, typed on the page) stay blank.
UPDATE tb_expenses e
   SET saved_by = a.name
  FROM tb_expense_actions act
  CROSS JOIN LATERAL jsonb_array_elements(act.changes) c
  JOIN tb_expense_admins a ON a.phone = act.phone AND a.group_name = act.group_name
 WHERE act.kind = 'add'
   AND (c->>'id') ~ '^\d+$'
   AND (c->>'id')::int = e.id
   AND e.saved_by IS NULL;

-- SPENT BY, linked only on an EXACT name (case and spaces aside) that one
-- person holds. "<Name> difference" is <Name>'s, so those rows are left out
-- of the people matched against and the suffix is dropped from the expense.
-- Everything else stays unlinked, and the Expenses page offers a pick.
WITH people AS (
  SELECT lower(regexp_replace(btrim(display_name), '\s+', ' ', 'g')) AS n,
         min(person_id) AS person_id,
         count(*) AS c
    FROM tb_people
   WHERE display_name !~* '\s(difference|diff)\s*$'
   GROUP BY 1
), spent AS (
  SELECT id,
         lower(regexp_replace(btrim(regexp_replace(spent_by, '\s+(difference|diff)\s*$', '', 'i')), '\s+', ' ', 'g')) AS n
    FROM tb_expenses
   WHERE spent_by_person_id IS NULL AND spent_by IS NOT NULL AND btrim(spent_by) <> ''
)
UPDATE tb_expenses e
   SET spent_by_person_id = p.person_id
  FROM spent s
  JOIN people p ON p.n = s.n AND p.c = 1
 WHERE s.id = e.id;
