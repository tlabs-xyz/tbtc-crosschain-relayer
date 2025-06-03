/*
  Warnings:

  - Added the required column `wormholeInfo` to the `Deposit` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Deposit" ADD COLUMN     "wormholeInfo" JSONB NOT NULL;
