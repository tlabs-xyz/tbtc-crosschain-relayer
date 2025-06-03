import { prisma } from '../utils/prisma.js';
import * as fs from 'fs';
import * as readline from 'readline';
import path from 'path';
import { chainConfigs, type AnyChainConfig } from '../config/index.js';
import logger from '../utils/Logger.js';

const LOG_FILE = path.resolve('logs/deposit_audit.log');

async function getDefaultChainIdForBackfill(): Promise<string> {
  logger.info('Attempting to determine default chainName for backfilling existing records...');
  // Convert chainConfigs object to an array of configs
  const configsArray: AnyChainConfig[] = Object.values(chainConfigs).filter(
    (config): config is AnyChainConfig => !!config,
  );

  if (configsArray.length === 0) {
    logger.error('CRITICAL: No chain configurations found in the loaded chainConfigs object.');
    logger.error('Expected at least one chain configuration to proceed with migration.');
    logger.error('Please check your configuration files and ensure they are loaded correctly.');
    logger.error(
      'If you are running this script standalone, ensure the proper environment variables are set.',
    );
    process.exit(1);
  }

  if (configsArray.length > 1) {
    logger.error('CRITICAL: Multiple chain configurations were loaded.');
    logger.error(`Loaded chains: ${configsArray.map((c) => c.chainName).join(', ')}`);
    logger.error('This migration script requires exactly one chain configuration.');
    logger.error('Please ensure only one chain configuration is active for this migration.');
    process.exit(1);
  }

  const primaryConfig = configsArray[0];
  const defaultChainName = primaryConfig.chainName;

  if (!defaultChainName || typeof defaultChainName !== 'string' || defaultChainName.trim() === '') {
    logger.error(
      `CRITICAL: Invalid chainName ('${defaultChainName}') obtained from the primary configuration: ${JSON.stringify(primaryConfig)}`,
    );
    logger.error('CRITICAL: Failed to determine default chainName from configuration.');
    logger.error(
      'Please check your configuration setup and ensure it follows the expected structure.',
    );
    process.exit(1);
  }

  logger.info(
    `Determined default chainName: '${defaultChainName}' from the sole configuration entry.`,
  );
  return defaultChainName;
}

async function backfillChainIdInDbTables(defaultChainName: string, dry: boolean) {
  logger.info(`\nStarting backfill of chainName ('${defaultChainName}') for existing records...`);

  // Handle each table individually to avoid union type issues
  logger.info(`Checking table: Deposit for records with empty/null chainName.`);
  if (dry) {
    // For required fields, we use raw SQL to check for NULL since TypeScript doesn't allow it
    const depositCountResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) FROM "Deposit" WHERE "chainName" IS NULL OR "chainName" = ''
    `;
    const depositCount = Number(depositCountResult[0].count);
    logger.info(
      `[DRY RUN] Would update ${depositCount} records in Deposit to set chainName = '${defaultChainName}'.`,
    );
  } else {
    try {
      // Use raw SQL for the update since TypeScript prevents querying null on required fields
      const depositResult = await prisma.$executeRaw`
        UPDATE "Deposit" SET "chainName" = ${defaultChainName} 
        WHERE "chainName" IS NULL OR "chainName" = ''
      `;
      logger.info(
        `Updated ${depositResult} records in Deposit with chainName = '${defaultChainName}'.`,
      );
    } catch (error) {
      logger.error(`Error backfilling chainName for table Deposit:`, error);
      throw error;
    }
  }

  logger.info(`Checking table: AuditLog for records with null chainName.`);
  if (dry) {
    const auditLogCount = await prisma.auditLog.count({ where: { chainName: null } });
    logger.info(
      `[DRY RUN] Would update ${auditLogCount} records in AuditLog to set chainName = '${defaultChainName}'.`,
    );
  } else {
    try {
      const auditLogResult = await prisma.auditLog.updateMany({
        where: { chainName: null },
        data: { chainName: defaultChainName },
      });
      logger.info(
        `Updated ${auditLogResult.count} records in AuditLog with chainName = '${defaultChainName}'.`,
      );
    } catch (error) {
      logger.error(`Error backfilling chainName for table AuditLog:`, error);
      throw error;
    }
  }

  logger.info(`Checking table: Redemption for records with empty/null chainName.`);
  if (dry) {
    // For required fields, we use raw SQL to check for NULL since TypeScript doesn't allow it
    const redemptionCountResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) FROM "Redemption" WHERE "chainName" IS NULL OR "chainName" = ''
    `;
    const redemptionCount = Number(redemptionCountResult[0].count);
    logger.info(
      `[DRY RUN] Would update ${redemptionCount} records in Redemption to set chainName = '${defaultChainName}'.`,
    );
  } else {
    try {
      // Use raw SQL for the update since TypeScript prevents querying null on required fields
      const redemptionResult = await prisma.$executeRaw`
        UPDATE "Redemption" SET "chainName" = ${defaultChainName} 
        WHERE "chainName" IS NULL OR "chainName" = ''
      `;
      logger.info(
        `Updated ${redemptionResult} records in Redemption with chainName = '${defaultChainName}'.`,
      );
    } catch (error) {
      logger.error(`Error backfilling chainName for table Redemption:`, error);
      throw error;
    }
  }

  logger.info('Backfill of chainName in database tables complete.');
}

async function migrateAuditLog({ dry }: { dry: boolean }) {
  const defaultChainName = await getDefaultChainIdForBackfill();

  await backfillChainIdInDbTables(defaultChainName, dry);

  logger.info(`\nStarting migration of audit logs from file: ${LOG_FILE}`);
  logger.info(`New entries will be assigned chainName: '${defaultChainName}'`);

  if (!fs.existsSync(LOG_FILE)) {
    logger.error(`Log file not found: ${LOG_FILE}`);
    process.exit(1);
  }

  const fileStream = fs.createReadStream(LOG_FILE);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  let count = 0;
  let errors = 0;
  let fileEntriesProcessed = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    fileEntriesProcessed++;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (err) {
      logger.error(`Invalid JSON at line ${fileEntriesProcessed}:`, err);
      errors++;
      continue;
    }
    const { timestamp, eventType, depositId, data } = entry;
    if (dry) {
      logger.info(`[DRY RUN] Would insert:`, {
        timestamp,
        eventType,
        depositId,
        data,
        chainName: defaultChainName,
      });
    } else {
      try {
        await prisma.auditLog.create({
          data: {
            timestamp: timestamp ? new Date(timestamp) : undefined,
            eventType,
            depositId,
            data,
            chainName: defaultChainName,
          },
        });
      } catch (err) {
        logger.error(`Failed to insert log at line ${fileEntriesProcessed}:`, err);
        errors++;
        continue;
      }
    }
    count++;
    if (count % 100 === 100) logger.info(`Processed ${count} lines from log file...`);
  }
  logger.info(
    `\nLog file migration complete. Processed: ${count} entries from file. Errors: ${errors}`,
  );
  await prisma.$disconnect();
}

const dry = process.argv.includes('--dry');

migrateAuditLog({ dry }).catch((err) => {
  logger.error('Migration failed:', err);
  process.exit(1);
});
