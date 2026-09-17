ALTER TABLE "computers" ADD COLUMN "desiredProviderKind" TEXT;

-- Existing computers keep their current provider until an owner explicitly selects another.
UPDATE "computers" SET "desiredProviderKind" = "kind" WHERE "desiredProviderKind" IS NULL;
