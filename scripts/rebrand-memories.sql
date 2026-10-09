-- Rebrand stored agent text from "Rakazo" to "JEWL": bot personas and instructions, bot
-- templates, markdown memory documents, and history/chat summaries the agent reads back.
--
-- Only the capitalized word "Rakazo" is replaced. Lowercase identifiers (paths such as
-- /home/rakazo, env names such as RAKAZO_*) and the credit phrase "forked from Rakazo" are kept.
-- Message history and memory revision history are not rewritten; a changed memory document gets a
-- new revision, as a normal memory save would.
--
-- Everything runs in one transaction. Without `-v apply=1` the changes are previewed and rolled
-- back. With it, each original value is first copied to jewl_rebrand.backup (outside the Prisma
-- schema), then updated. Rerunning is a no-op once nothing matches, and the backup keeps the
-- value from the first run.
--
-- Production (take a full backup first):
--   bash infra/compose/backup-prod.sh
--   docker compose --env-file .env -f infra/compose/docker-compose.prod.yml exec -T postgres \
--     sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < scripts/rebrand-memories.sql
--   # review the preview, then the same command with: psql -v apply=1 -v ON_ERROR_STOP=1 ...
--
-- Restore one column from the backup, for example:
--   UPDATE bots b SET instructions = k.original FROM jewl_rebrand.backup k
--   WHERE k.tbl = 'bots' AND k.col = 'instructions' AND k.row_id = b.id;

\set ON_ERROR_STOP on
\if :{?apply}
\else
\set apply 0
\endif

BEGIN;

CREATE FUNCTION pg_temp.jewl(value text) RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT regexp_replace(value, '(?<!forked from )\mRakazo\M', 'JEWL', 'g') $$;

CREATE TEMP TABLE jewl_targets (tbl text, col text, touch_updated_at boolean) ON COMMIT DROP;
INSERT INTO jewl_targets VALUES
  ('bots', 'name', true),
  ('bots', 'title', true),
  ('bots', 'description', true),
  ('bots', 'instructions', true),
  ('bots', 'teamChatRules', true),
  ('bot_templates', 'name', true),
  ('bot_templates', 'title', true),
  ('bot_templates', 'description', true),
  ('bot_templates', 'instructions', true),
  ('memory_documents', 'content', true),
  ('threads', 'historyCompactionSummary', false),
  ('chat_sessions', 'summary', false);

CREATE TEMP TABLE jewl_changes (tbl text, row_id text, col text, before text, after text) ON COMMIT DROP;
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT * FROM jewl_targets LOOP
    EXECUTE format(
      'INSERT INTO jewl_changes SELECT %L, id, %L, %I, pg_temp.jewl(%I) FROM %I WHERE %I IS DISTINCT FROM pg_temp.jewl(%I)',
      t.tbl, t.col, t.col, t.col, t.tbl, t.col, t.col);
  END LOOP;
END $$;

SELECT tbl, col, count(*) AS rows_to_change FROM jewl_changes GROUP BY tbl, col ORDER BY tbl, col;
SELECT tbl, col, row_id, left(before, 160) AS before, left(after, 160) AS after
FROM jewl_changes ORDER BY tbl, col, row_id LIMIT 25;

CREATE SCHEMA IF NOT EXISTS jewl_rebrand;
CREATE TABLE IF NOT EXISTS jewl_rebrand.backup (
  tbl text NOT NULL,
  row_id text NOT NULL,
  col text NOT NULL,
  original text,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tbl, row_id, col)
);
INSERT INTO jewl_rebrand.backup (tbl, row_id, col, original)
SELECT tbl, row_id, col, before FROM jewl_changes
ON CONFLICT DO NOTHING;

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT * FROM jewl_targets WHERE tbl <> 'memory_documents' LOOP
    EXECUTE format(
      'UPDATE %I SET %I = pg_temp.jewl(%I)%s WHERE %I IS DISTINCT FROM pg_temp.jewl(%I)',
      t.tbl, t.col, t.col,
      CASE WHEN t.touch_updated_at THEN ', "updatedAt" = now()' ELSE '' END,
      t.col, t.col);
  END LOOP;
END $$;

-- A memory save bumps the revision and appends the new content to the revision history.
WITH changed AS (
  UPDATE memory_documents
  SET content = pg_temp.jewl(content), revision = revision + 1, "updatedAt" = now()
  WHERE content IS DISTINCT FROM pg_temp.jewl(content)
  RETURNING id, revision, content
)
INSERT INTO memory_revisions (id, "documentId", revision, content, "createdAt")
SELECT gen_random_uuid()::text, id, revision, content, now() FROM changed;

\if :apply
COMMIT;
\echo 'Applied. Originals are in jewl_rebrand.backup.'
\else
ROLLBACK;
\echo 'Dry run only; nothing was changed. Rerun with -v apply=1 to apply.'
\endif
