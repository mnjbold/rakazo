-- CreateTable
CREATE TABLE "reply_quality" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "scores" JSONB,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reply_quality_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reply_quality_runId_key" ON "reply_quality"("runId");

-- CreateIndex
CREATE INDEX "reply_quality_botId_createdAt_idx" ON "reply_quality"("botId", "createdAt");

-- AddForeignKey
ALTER TABLE "reply_quality" ADD CONSTRAINT "reply_quality_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
