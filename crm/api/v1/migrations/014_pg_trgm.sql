-- Lets search_master_sheet (the polishing agent's lookup tool) suggest a
-- close match on a typo'd name instead of flatly saying "not recognized" —
-- "deivivas" should surface "Deividas" as a "did you mean" candidate, not
-- silently return nothing. Standard, Supabase-approved extension.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram GIN indexes so a similarity search on a ~150-row table stays
-- instant as it grows — cheap now, correct at any size later.
CREATE INDEX IF NOT EXISTS master_sheet_rows_person_name_trgm_idx
  ON master_sheet_rows USING gin (person_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS master_sheet_rows_company_trgm_idx
  ON master_sheet_rows USING gin (company gin_trgm_ops);
