import type { Deposit } from '../types/Deposit.type.js';
import { DepositStore } from '../utils/DepositStore.js';
import logger, { logErrorContext } from '../utils/Logger.js';
import { logDepositDeleted } from '../utils/AuditLog.js';
import { DepositStatus } from '../types/DepositStatus.enum.js';

/****************************************************************************************
The goal of this task is cleaning up trash deposits and preventing relayer's congestion.

This task should:
- Delete (remove from persistent storage) QUEUED deposits that have been in that state for more than 48 hours.
- Delete (remove from persistent storage) any deposits that are in the FINALIZED state for more than 12 hours.

More info:
https://www.notion.so/thresholdnetwork/L2-tBTC-SDK-Relayer-Implementation-4dfedabfcf594c7d8ef80609541cf791?pvs=4
****************************************************************************************/

/**
 * Helper function to safely extract error message
 */
const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

/**
 * Constants for cleanup configuration
 */
const CLEANUP_CONFIG = {
  MS_PER_HOUR: 60 * 60 * 1000,
  DEFAULT_QUEUED_HOURS: 48,
  DEFAULT_FINALIZED_HOURS: 12,
  DEFAULT_BRIDGED_HOURS: 12,
} as const;

/**
 * Configuration for cleanup operations
 */
interface CleanupConfig {
  status: DepositStatus;
  envVar: string;
  defaultHours: number;
  dateField: keyof Deposit['dates'];
  statusName: string;
}

/**
 * Generic cleanup function for deposits based on age
 */
const cleanupDepositsByAge = async (config: CleanupConfig): Promise<void> => {
  try {
    const timeoutHours = parseInt(process.env[config.envVar] || String(config.defaultHours), 10);
    const timeoutMs = timeoutHours * CLEANUP_CONFIG.MS_PER_HOUR;

    const deposits = await DepositStore.getByStatus(config.status);
    const currentTime = Date.now();

    for (const { id, dates } of deposits) {
      try {
        const dateValue = dates?.[config.dateField];
        const timestamp = dateValue ? new Date(dateValue).getTime() : null;

        if (!timestamp) continue;

        const ageInMs = currentTime - timestamp;

        if (ageInMs > timeoutMs) {
          const ageInHours = (ageInMs / CLEANUP_CONFIG.MS_PER_HOUR).toFixed(2);

          try {
            const deposit = await DepositStore.getById(id);
            if (deposit) {
              await logDepositDeleted(
                deposit,
                `${config.statusName} deposit exceeded age limit (${ageInHours} hours)`,
              );
            }
          } catch (auditError: unknown) {
            logger.error(
              `Failed to create audit log for deposit ${id}: ${getErrorMessage(auditError)}`,
            );
            // Continue with deletion even if audit logging fails
          }

          try {
            await DepositStore.delete(id);
            logger.info(`Deleted ${config.statusName} deposit ${id} (age: ${ageInHours} hours)`);
          } catch (deleteError: unknown) {
            logger.error(`Failed to delete deposit ${id}: ${getErrorMessage(deleteError)}`);
          }
        }
      } catch (error: unknown) {
        logger.error(`Error processing deposit ${id} for cleanup: ${getErrorMessage(error)}`);
      }
    }
  } catch (error: unknown) {
    logErrorContext(`Error in cleanup${config.statusName}Deposits:`, error);
    throw error;
  }
};

/**
 * @name cleanQueuedDeposits
 * @description Cleans up the deposits that have been in the QUEUED state for more than 48 hours.
 * @returns {Promise<void>} A promise that resolves when the old queued deposits are deleted.
 */
export const cleanQueuedDeposits = async (): Promise<void> => {
  await cleanupDepositsByAge({
    status: DepositStatus.QUEUED,
    envVar: 'CLEAN_QUEUED_TIME',
    defaultHours: CLEANUP_CONFIG.DEFAULT_QUEUED_HOURS,
    dateField: 'createdAt',
    statusName: 'QUEUED',
  });
};

/**
 * @name cleanFinalizedDeposits
 * @description Cleans up the deposits that have been in the FINALIZED state for more than 12 hours.
 * @returns {Promise<void>} A promise that resolves when the old finalized deposits are deleted.
 */
export const cleanFinalizedDeposits = async (): Promise<void> => {
  await cleanupDepositsByAge({
    status: DepositStatus.FINALIZED,
    envVar: 'CLEAN_FINALIZED_TIME',
    defaultHours: CLEANUP_CONFIG.DEFAULT_FINALIZED_HOURS,
    dateField: 'finalizationAt',
    statusName: 'FINALIZED',
  });
};

/**
 * @name cleanBridgedDeposits
 * @description Cleans up the deposits that have been in the BRIDGED state for more than 12 hours.
 * @returns {Promise<void>} A promise that resolves when the old awaiting vaa deposits are deleted.
 */
export const cleanBridgedDeposits = async (): Promise<void> => {
  await cleanupDepositsByAge({
    status: DepositStatus.BRIDGED,
    envVar: 'CLEAN_BRIDGED_TIME',
    defaultHours: CLEANUP_CONFIG.DEFAULT_BRIDGED_HOURS,
    dateField: 'bridgedAt',
    statusName: 'BRIDGED',
  });
};
