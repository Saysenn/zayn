-- ===============================
-- * The boss's OLD group name for a company.
-- ===============================
-- His per-group sheets carry an "Old group" column beside the Active
-- company list. Its values are `Milky`, `Wallaby 1`, `V3`, `NA`.
--
-- NOT ONE OF OUR GROUPS, and it must never be matched against one. Our
-- groups are NEXUS, INDIGO, MILKMAN, MANBAT and ALL BOOKS; these are his
-- own earlier naming, and `Milky` resembling `MILKMAN` is a coincidence to
-- resist rather than a mapping to build. Folding them would rewrite which
-- group a company belongs to off a column that is only a memo.
--
-- FREE TEXT, and NULLable. Only one of his three files carries the column
-- at all, and a company nobody has recorded an old name for is the normal
-- case, not a gap.
ALTER TABLE tb_companies ADD COLUMN IF NOT EXISTS old_group text;

-- Filtered on from the Companies page, and the list is small.
CREATE INDEX IF NOT EXISTS tb_companies_old_group_idx
  ON tb_companies (lower(old_group)) WHERE old_group IS NOT NULL;
