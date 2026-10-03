-- Separate from updated_at (admin edits). Touched on every sync regardless
-- of whether the row already existed — a company that stops getting touched
-- here is a company the sheet no longer mentions under this name: either
-- closed, or renamed. Either way, worth surfacing rather than staying
-- silently "active" forever.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_seen_at timestamp NOT NULL DEFAULT now();
