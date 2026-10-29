ALTER TABLE "events" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "IdempotencyRecord" (
    "key" VARCHAR(128) NOT NULL PRIMARY KEY,
    "userId" VARCHAR(64) NOT NULL,
    "endpoint" VARCHAR(255) NOT NULL,
    "payloadHash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL CHECK ("status" IN ('IN_PROGRESS', 'COMPLETED')),
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "lockedUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "IdempotencyRecord_userId_createdAt_idx" ON "IdempotencyRecord"("userId", "createdAt");
