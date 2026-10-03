-- DIANE'S MEMORY. What was said, kept so she can be asked about it later.
--
-- Nothing here is in the burn's TRUNCATE, so the monthly wipe leaves it
-- alone. That is deliberate and it is the whole point: the master sheet is
-- the present tense and gets replaced every month, while what was DISCUSSED
-- is the part worth accumulating.
--
-- The FK below is safe for the same reason. tb_conversations is not in
-- burn.repo.js's TRUNCATE list, so CASCADE cannot reach these two.
--
-- NO PRUNING, decided 2026-08-27. Under 4MB a year, and the point of the
-- feature is that she improves the longer she has been running. Revisit
-- when multi user lands, because that is when more than one person can
-- read them.

CREATE TABLE IF NOT EXISTS tb_conversations (
  -- The BROWSER generates this, not the database. A conversation is saved
  -- once when it ends, and the end can fire twice (the orb closing and the
  -- tab unloading), so the id has to be known before the first write for
  -- the second one to be an upsert rather than a duplicate.
  id             uuid PRIMARY KEY,
  started_at     timestamptz NOT NULL,
  ended_at       timestamptz NOT NULL DEFAULT now(),
  message_count  integer     NOT NULL DEFAULT 0,

  -- Written in the same request as the transcript. NULL means the model
  -- call failed; the conversation is still saved and the summary can be
  -- filled later. Losing a summary must never mean losing the record.
  summary        text,

  -- WHAT THIS CONVERSATION ACTED ON, from the tool results themselves.
  -- Recall for "Gloria" then returns the conversations that touched her
  -- rows rather than whatever full text search happens to match, and
  -- ordering by date makes the newest win without any supersession logic.
  touched_rows   integer[] NOT NULL DEFAULT '{}',
  touched_people text[]    NOT NULL DEFAULT '{}',
  touched_groups text[]    NOT NULL DEFAULT '{}'
);

-- Full text over the SUMMARY, not the messages. Searching raw chat mostly
-- retrieves greetings; searching a paragraph about what was decided
-- retrieves decisions. Generated so it can never drift from the summary.
ALTER TABLE tb_conversations
  ADD COLUMN IF NOT EXISTS search tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(summary, ''))) STORED;

CREATE TABLE IF NOT EXISTS tb_conversation_messages (
  id              bigserial PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES tb_conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant')),
  content         text NOT NULL,
  -- Order within the conversation. Not a timestamp: the whole transcript
  -- arrives in one request, so every row would share a moment and the
  -- ordering would depend on insertion luck.
  position        integer NOT NULL
);

CREATE INDEX IF NOT EXISTS tb_conversations_search_idx
  ON tb_conversations USING gin (search);
CREATE INDEX IF NOT EXISTS tb_conversations_people_idx
  ON tb_conversations USING gin (touched_people);
CREATE INDEX IF NOT EXISTS tb_conversations_ended_idx
  ON tb_conversations (ended_at DESC);
CREATE INDEX IF NOT EXISTS tb_conversation_messages_order_idx
  ON tb_conversation_messages (conversation_id, position);
