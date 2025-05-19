// Use the test Prisma client for test DB in test environment
let PrismaClient: any;
if (process.env.NODE_ENV === 'test') {
  PrismaClient = require('@prisma/client-test').PrismaClient;
} else {
  PrismaClient = require('@prisma/client').PrismaClient;
}
import * as fs from 'fs';
import * as readline from 'readline';
import path from 'path';

const prisma = new PrismaClient();
const LOG_FILE = path.resolve('logs/deposit_audit.log');

async function migrateAuditLog({ dry }: { dry: boolean }) {
  if (!fs.existsSync(LOG_FILE)) {
    console.error(`Log file not found: ${LOG_FILE}`);
    process.exit(1);
  }

  const fileStream = fs.createReadStream(LOG_FILE);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  let count = 0;
  let errors = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (err) {
      console.error(`Invalid JSON at line ${count + 1}:`, err);
      errors++;
      continue;
    }
    const { timestamp, eventType, depositId, data } = entry;
    if (dry) {
      console.log(`[DRY RUN] Would insert:`, { timestamp, eventType, depositId, data });
    } else {
      try {
        await prisma.auditLog.create({
          data: {
            timestamp: timestamp ? new Date(timestamp) : undefined,
            eventType,
            depositId,
            data,
          },
        });
      } catch (err) {
        console.error(`Failed to insert log at line ${count + 1}:`, err);
        errors++;
        continue;
      }
    }
    count++;
    if (count % 100 === 0) console.log(`Processed ${count} lines...`);
  }
  console.log(`\nMigration complete. Processed: ${count} lines. Errors: ${errors}`);
  await prisma.$disconnect();
}

const dry = process.argv.includes('--dry');

migrateAuditLog({ dry }).catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
}); 