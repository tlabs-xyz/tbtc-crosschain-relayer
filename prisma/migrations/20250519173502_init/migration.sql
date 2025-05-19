-- CreateTable
CREATE TABLE "Deposit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fundingTxHash" TEXT NOT NULL,
    "outputIndex" INTEGER NOT NULL,
    "hashes" JSONB NOT NULL,
    "receipt" JSONB NOT NULL,
    "owner" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "L1OutputEvent" JSONB,
    "dates" JSONB NOT NULL,
    "error" TEXT
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventType" TEXT NOT NULL,
    "depositId" TEXT,
    "data" JSONB NOT NULL,
    "errorCode" INTEGER
);

-- CreateTable
CREATE TABLE "Redemption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "data" JSONB NOT NULL
);
