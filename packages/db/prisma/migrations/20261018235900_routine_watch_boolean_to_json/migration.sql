-- JEWL fork: 20260927140000_routine_watch added "watch" as BOOLEAN. Upstream's watch
-- routines (20261019000000_routine_watch) use a JSONB "watch" column added with
-- IF NOT EXISTS, which would silently keep the boolean. Drop the boolean column so the
-- upstream migration creates the JSONB one. Boolean watch flags are not carried over:
-- upstream watch routines need an explicit check definition.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'routines' AND column_name = 'watch' AND data_type = 'boolean'
  ) THEN
    ALTER TABLE "routines" DROP COLUMN "watch";
  END IF;
END $$;
