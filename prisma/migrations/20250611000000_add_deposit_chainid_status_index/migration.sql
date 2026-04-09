-- CreateIndex
CREATE INDEX "Deposit_chainId_status_idx" ON "Deposit"("chainId", "status");

-- DropIndex (redundant: composite index covers chainId-only lookups)
DROP INDEX "Deposit_chainId_idx";
