-- Shareable bot profile snapshots. Secrets, connections, memory, and history stay on the source bot.
CREATE TABLE "bot_templates" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "instructions" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_templates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bot_templates_visibility_check" CHECK ("visibility" IN ('space', 'public'))
);

CREATE INDEX "bot_templates_spaceId_createdAt_idx" ON "bot_templates"("spaceId", "createdAt");
CREATE INDEX "bot_templates_visibility_createdAt_idx" ON "bot_templates"("visibility", "createdAt");
CREATE INDEX "bot_templates_userId_idx" ON "bot_templates"("userId");

ALTER TABLE "bot_templates"
  ADD CONSTRAINT "bot_templates_spaceId_fkey"
  FOREIGN KEY ("spaceId") REFERENCES "spaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bot_templates"
  ADD CONSTRAINT "bot_templates_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
