import { logErrorContext } from '../utils/Logger.js';
import cron from 'node-cron';

import logger from '../utils/Logger.js';
import { ChainHandlerFactory } from '../handlers/ChainHandlerFactory.js';
import type { ChainConfig } from '../types/ChainConfig.type.js';
import { loadChainConfigs } from '../utils/ConfigLoader.js';
import {
  cleanQueuedDeposits,
  cleanFinalizedDeposits,
  cleanBridgedDeposits,
} from './CleanupDeposits.js';
import { L2RedemptionService } from './L2RedemptionService.js';
import { RedemptionStore } from '../utils/RedemptionStore.js';
import { RedemptionStatus } from '../types/Redemption.type.js';

// Multi-chain configuration and handler initialization
export const chainHandlers: Map<string, any> = new Map();
export let chainConfigs: ChainConfig[] = [];
const l2RedemptionServices: Map<string, L2RedemptionService> = new Map();

export async function initializeChainHandlers() {
  chainConfigs = await loadChainConfigs();
  await Promise.all(
    chainConfigs.map(async (config) => {
      const handler = ChainHandlerFactory.createHandler(config);
      chainHandlers.set(config.chainName, handler);
      logger.info(`Initialized handler for chain: ${config.chainName}`);
    })
  );
}

export const startCronJobs = () => {
  logger.debug('Starting multi-chain cron job setup...');

  // Every minute - process deposits
  cron.schedule('* * * * *', async () => {
    await Promise.all(
      Array.from(chainHandlers.entries()).map(async ([chainName, handler]) => {
        try {
          await handler.processWormholeBridging?.();
          await handler.processFinalizeDeposits();
          await handler.processInitializeDeposits();
        } catch (error) {
          logErrorContext(`Error in deposit processing cron job for ${chainName}:`, error);
        }
      })
    );
  });

  // Every 2 minutes - process redemptions
  cron.schedule('*/2 * * * *', async () => {
    await Promise.all(
      Array.from(chainHandlers.entries()).map(async ([chainName, handler]) => {
        try {
          let l2Service = l2RedemptionServices.get(chainName);
          if (!l2Service) {
            const config = chainConfigs.find(c => c.chainName === chainName)!;
            l2Service = await L2RedemptionService.create(config);
            l2RedemptionServices.set(chainName, l2Service);
          }
          await l2Service.processPendingRedemptions();
          await l2Service.processVaaFetchedRedemptions();
        } catch (error) {
          logErrorContext(`Error in redemption processing cron job for ${chainName}:`, error);
        }
      })
    );
  });

  // Every 60 minutes - check for past deposits
  cron.schedule('*/60 * * * *', async () => {
    await Promise.all(
      Array.from(chainHandlers.entries()).map(async ([chainName, handler]) => {
        try {
          if (handler.supportsPastDepositCheck()) {
            const latestBlock = await handler.getLatestBlock();
            if (latestBlock > 0) {
              logger.debug(`Running checkForPastDeposits for ${chainName} (Latest Block/Slot: ${latestBlock})`);
              await handler.checkForPastDeposits({
                pastTimeInMinutes: 60,
                latestBlock: latestBlock,
              });
            } else {
              logger.warn(`Skipping checkForPastDeposits for ${chainName} - Invalid latestBlock received: ${latestBlock}`);
            }
          } else {
            logger.debug(`Skipping checkForPastDeposits for ${chainName} - Handler does not support it (e.g., using endpoint).`);
          }
        } catch (error) {
          logErrorContext(`Error in past deposits cron job for ${chainName}:`, error);
        }
      })
    );
  });

  // Every 10 minutes - cleanup
  cron.schedule('*/10 * * * *', async () => {
    try {
      await cleanQueuedDeposits();
      await cleanFinalizedDeposits();
      await cleanBridgedDeposits();
    } catch (error) {
      logErrorContext('Error in cleanup cron job:', error);
    }
  });

  // Every 60 minutes - cleanup old redemptions
  cron.schedule('*/60 * * * *', async () => {
    try {
      const now = Date.now();
      const retentionMs = 7 * 24 * 60 * 60 * 1000; // 7 days
      const allRedemptions = await RedemptionStore.getAll();
      for (const redemption of allRedemptions) {
        if (
          (redemption.status === RedemptionStatus.COMPLETED ||
            redemption.status === RedemptionStatus.FAILED) &&
          redemption.dates.completedAt &&
          now - redemption.dates.completedAt > retentionMs
        ) {
          await RedemptionStore.delete(redemption.id);
          logger.info(`Cleaned up redemption ${redemption.id} (status: ${redemption.status})`);
        }
      }
    } catch (error) {
      logErrorContext('Error in redemption cleanup cron job:', error);
    }
  });

  logger.debug('Multi-chain cron job setup complete.');
};

export const initializeAllChains = async () => {
  await Promise.all(
    Array.from(chainHandlers.entries()).map(async ([chainName, handler]) => {
      try {
        await handler.initialize();
        await handler.setupListeners();
        logger.debug(`Deposit chain handler for ${chainName} successfully initialized`);
      } catch (error) {
        logErrorContext(`Failed to initialize deposit chain handler for ${chainName}:`, error);
      }
    })
  );
};

export const initializeAllL2RedemptionServices = async () => {
  await Promise.all(
    Array.from(chainHandlers.entries()).map(async ([chainName, handler]) => {
      try {
        const config = chainConfigs.find(c => c.chainName === chainName)!;
        let l2Service = l2RedemptionServices.get(chainName);
        if (!l2Service) {
          l2Service = await L2RedemptionService.create(config);
          l2RedemptionServices.set(chainName, l2Service);
        }
        l2Service.startListening();
        logger.info(`L2RedemptionService for ${chainName} initialized and started successfully.`);
      } catch (error) {
        logErrorContext(`Failed to initialize or start L2RedemptionService for ${chainName}:`, error);
      }
    })
  );
};
