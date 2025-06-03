/*
  Warnings:

  - You are about to drop the column `chainId` on the `AuditLog` table. All the data in the column will be lost.
  - You are about to drop the column `chainId` on the `Deposit` table. All the data in the column will be lost.
  - You are about to drop the column `chainId` on the `Redemption` table. All the data in the column will be lost.
  - Added the required column `chainName` to the `Deposit` table without a default value. This is not possible if the table is not empty.
  - Added the required column `chainName` to the `Redemption` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "AuditLog_chainId_idx";

-- DropIndex
DROP INDEX "Deposit_chainId_idx";

-- DropIndex
DROP INDEX "Redemption_chainId_idx";

-- AlterTable
ALTER TABLE "AuditLog" DROP COLUMN "chainId",
ADD COLUMN     "chainName" TEXT;

-- AlterTable
ALTER TABLE "Deposit" DROP COLUMN "chainId",
ADD COLUMN     "chainName" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Redemption" DROP COLUMN "chainId",
ADD COLUMN     "chainName" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "AuditLog_chainName_idx" ON "AuditLog"("chainName");

-- CreateIndex
CREATE INDEX "Deposit_chainName_idx" ON "Deposit"("chainName");

-- CreateIndex
CREATE INDEX "Redemption_chainName_idx" ON "Redemption"("chainName");
