-- ===============================
-- * WHO RUNS A NO-DEALS COMPANY, AS THE CLOSURE SHEET SAYS (his call 2026-11-04)
-- ===============================
-- The page's Director, Mid and Group come from the company's deals. A
-- company with no deals with us had them only in its note, written there by
-- the closure import. They are fields now, shown in those columns when the
-- deals give nothing. Never people on the master sheet: those are who we pay.
ALTER TABLE tb_liquidations
  ADD COLUMN IF NOT EXISTS sheet_director text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sheet_mid      text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sheet_group    text NOT NULL DEFAULT '';

-- FILLED FROM THE NOTE the import wrote: "Director: X · Mid: Y · Group: Z
-- (from the closure sheet)". The note stays as it is. Each value filled is
-- on the audit trail, via import, so its history says where it came from.
WITH parsed AS (
  SELECT id, company_key,
         btrim(substring(note FROM 'Director: ([^·(]+)')) AS director,
         btrim(substring(note FROM 'Mid: ([^·(]+)'))      AS mid,
         btrim(substring(note FROM 'Group: ([^·(]+)'))    AS grp
    FROM tb_liquidations
   WHERE note LIKE '%(from the closure sheet)%'
     AND sheet_director = '' AND sheet_mid = '' AND sheet_group = ''
), filled AS (
  UPDATE tb_liquidations l
     SET sheet_director = COALESCE(p.director, ''), sheet_mid = COALESCE(p.mid, ''), sheet_group = COALESCE(p.grp, '')
    FROM parsed p WHERE p.id = l.id
  RETURNING l.id, l.company_key, l.sheet_director, l.sheet_mid, l.sheet_group
)
INSERT INTO tb_liquidation_audit (liquidation_id, company_key, field, old_value, new_value, by_user, via, source)
SELECT id, company_key, f.field, NULL, f.value, 'closure sheet', 'import', 'from its note (migration 093)'
  FROM filled, LATERAL (VALUES ('sheet_director', sheet_director), ('sheet_mid', sheet_mid), ('sheet_group', sheet_group)) AS f(field, value)
 WHERE f.value <> '';
