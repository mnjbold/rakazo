-- Shared agent skills and tool-source configs. Credentials stay with the source install.
CREATE TABLE "marketplace_items" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketplace_items_kind_check" CHECK ("kind" IN ('skill', 'plugin')),
    CONSTRAINT "marketplace_items_visibility_check" CHECK ("visibility" IN ('space', 'public'))
);

CREATE INDEX "marketplace_items_spaceId_createdAt_idx" ON "marketplace_items"("spaceId", "createdAt");
CREATE INDEX "marketplace_items_visibility_createdAt_idx" ON "marketplace_items"("visibility", "createdAt");
CREATE INDEX "marketplace_items_userId_idx" ON "marketplace_items"("userId");

ALTER TABLE "marketplace_items"
  ADD CONSTRAINT "marketplace_items_spaceId_fkey"
  FOREIGN KEY ("spaceId") REFERENCES "spaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "marketplace_items"
  ADD CONSTRAINT "marketplace_items_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
