import { logErrorContext } from '../utils/Logger.js';
import cron from 'node-cron';

import logger from '../utils/Logger.js';
import { chainHandlerRegistry } from '../handlers/ChainHandlerRegistry.js';
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
import { BaseChainHandler } from '../handlers/BaseChainHandler.js';

export let chainConfigs: ChainConfig[] = [];
const l2RedemptionServices: Map<string, L2RedemptionService> = new Map();

// Keep track of loaded configs so they can be exported for tests
let loadedChainConfigs: ChainConfig[] = [];

export async function initializeChainHandlers() {
  chainConfigs = await loadChainConfigs();
  await chainHandlerRegistry.initialize(chainConfigs);
  logger.info('ChainHandlerRegistry initialized for all chains.');
}

export const startCronJobs = () => {
  logger.debug('Starting multi-chain cron job setup...');

  // Every minute - process deposits
  cron.schedule('* * * * *', async () => {
    await Promise.all(
      chainHandlerRegistry.list().map(async (handler) => {
        const chainName = (handler as BaseChainHandler).config.chainName;
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
      chainHandlerRegistry.list().map(async (handler) => {
        const chainName = (handler as BaseChainHandler).config.chainName;
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
      chainHandlerRegistry.list().map(async (handler) => {
        const chainName = (handler as BaseChainHandler).config.chainName;
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

  if (process.env.ENABLE_CLEANUP_CRON === 'true') {
    // Every 10 minutes - cleanup deposits
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
    logger.info('Cleanup cron jobs ENABLED.');
  } else {
    logger.info('Cleanup cron jobs DISABLED by environment variable ENABLE_CLEANUP_CRON.');
  }

  logger.debug('Multi-chain cron job setup complete.');
};

export async function initializeAllChains(): Promise<void> {
  const configs = await loadChainConfigs();
  loadedChainConfigs = configs; // Store loaded configs
  
  if (configs.length === 0) {
    logger.warn('No chain configurations loaded. Relayer might not operate on any chain.');
    return;
  }
  logger.info(`Loaded ${configs.length} chain configurations: ${configs.map(c => c.chainName).join(', ')}`);
  await chainHandlerRegistry.initialize(configs); // This initializes and registers handlers
  logger.info('All chain handlers registered and basic setup complete.');
}

export function getLoadedChainConfigs(): ChainConfig[] {
  return loadedChainConfigs;
}

export async function initializeAllL2RedemptionServices(): Promise<void> {
  if (loadedChainConfigs.length === 0) {
    logger.warn('No chains loaded, skipping L2 Redemption Service initialization.');
    return;
  }
  logger.info('Initializing L2 Redemption Services for configured chains...');
  for (const config of loadedChainConfigs) {
    if (!l2RedemptionServices.has(config.chainName)) {
      try {
        const service = await L2RedemptionService.create(config); // Assuming create is async
        l2RedemptionServices.set(config.chainName, service);
        logger.info(`L2RedemptionService initialized for chain: ${config.chainName}`);
      } catch (error) {
        logger.error(`Failed to initialize L2RedemptionService for ${config.chainName}:`, error);
      }
    }
  }
  logger.info('All L2 Redemption Services initialized (or attempted).');
}
