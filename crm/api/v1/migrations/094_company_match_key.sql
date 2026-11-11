-- ===============================
-- * ONE COMPANY KEY EVERYWHERE (his call 2026-11-11)
-- ===============================
-- Two names are the same company only when, lower-cased and with everything
-- but a-z and 0-9 removed, they are equal letter by letter. "Click Pay" and
-- "Clickpay" are one company; "Reli PA" and "Relia PA" are two. Names
-- themselves are not touched. Same rule as shared/companyKey.js.

CREATE OR REPLACE FUNCTION company_match_key(v text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT regexp_replace(lower(coalesce(v, '')), '[^a-z0-9]', '', 'g') $$;

-- No two companies may share a key (was lower(name), migration 026).
DROP INDEX IF EXISTS tb_companies_name_key;
CREATE UNIQUE INDEX tb_companies_name_key ON tb_companies (company_match_key(name));

-- The Winding down page and its history store the key: moved to the new one.
UPDATE tb_liquidations SET company_key = company_match_key(company_key)
 WHERE company_key <> company_match_key(company_key);
UPDATE tb_liquidation_audit SET company_key = company_match_key(company_key)
 WHERE company_key IS NOT NULL AND company_key <> company_match_key(company_key);
