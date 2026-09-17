CREATE TABLE "execution_secrets" (
  "id" TEXT NOT NULL PRIMARY KEY, "ownerUserId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "secretId" TEXT NOT NULL UNIQUE, "status" TEXT NOT NULL DEFAULT 'active', "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "execution_secrets_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE,
  CONSTRAINT "execution_secrets_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "secrets"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "execution_secrets_ownerUserId_name_key" ON "execution_secrets"("ownerUserId","name");
CREATE INDEX "execution_secrets_ownerUserId_status_idx" ON "execution_secrets"("ownerUserId","status");
CREATE TABLE "secret_bindings" (
  "id" TEXT NOT NULL PRIMARY KEY, "executionSecretId" TEXT NOT NULL, "spaceId" TEXT NOT NULL,
  "botId" TEXT, "computerId" TEXT, "deliveryMode" TEXT NOT NULL, "destinationOrigin" TEXT,
  "allowedExecutable" TEXT, "expiresAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "secret_bindings_executionSecretId_fkey" FOREIGN KEY ("executionSecretId") REFERENCES "execution_secrets"("id") ON DELETE CASCADE,
  CONSTRAINT "secret_bindings_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE
);
CREATE INDEX "secret_bindings_spaceId_botId_computerId_idx" ON "secret_bindings"("spaceId","botId","computerId");
CREATE TABLE "secret_grants" (
  "id" TEXT NOT NULL PRIMARY KEY, "bindingId" TEXT NOT NULL, "runId" TEXT NOT NULL, "toolCallId" TEXT NOT NULL,
  "providerKind" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'issued', "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL, "consumedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3),
  CONSTRAINT "secret_grants_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "secret_bindings"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "secret_grants_bindingId_toolCallId_key" ON "secret_grants"("bindingId","toolCallId");
CREATE INDEX "secret_grants_runId_status_expiresAt_idx" ON "secret_grants"("runId","status","expiresAt");
CREATE TABLE "secret_audits" (
  "id" TEXT NOT NULL PRIMARY KEY, "secretId" TEXT, "actorUserId" TEXT NOT NULL, "spaceId" TEXT NOT NULL,
  "botId" TEXT, "computerId" TEXT, "action" TEXT NOT NULL, "reasonCode" TEXT, "providerKind" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "secret_audits_spaceId_createdAt_idx" ON "secret_audits"("spaceId","createdAt");
CREATE INDEX "secret_audits_secretId_createdAt_idx" ON "secret_audits"("secretId","createdAt");
