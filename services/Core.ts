import { logErrorContext, logChainCronError, logGlobalCronError } from '../utils/Logger.js';
import cron from 'node-cron';
import pLimit from 'p-limit';

import logger from '../utils/Logger.js';
import { ChainHandlerRegistry } from '../handlers/ChainHandlerRegistry.js';
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

const cronConcurrencyLimit = pLimit(3); // Concurrency limit for cron job tasks

export async function initializeChainHandlers(
  chainHandlerRegistry: ChainHandlerRegistry,
  configs: ChainConfig[]
) {
  chainConfigs = configs;
  await chainHandlerRegistry.initialize(configs);
  logger.info('ChainHandlerRegistry initialized for all chains.');
}

export const startCronJobs = (chainHandlerRegistry: ChainHandlerRegistry) => {
  logger.debug('Starting multi-chain cron job setup...');

  // Every minute - process deposits
  cron.schedule('* * * * *', async () => {
    await Promise.all(
      chainHandlerRegistry.list().map(async (handler) =>
        cronConcurrencyLimit(async () => {
          const chainName = (handler as BaseChainHandler).config.chainName;
          try {
            await handler.processWormholeBridging?.();
            await handler.processFinalizeDeposits();
            await handler.processInitializeDeposits();
          } catch (error) {
            logChainCronError(chainName, 'deposit processing', error);
          }
        })
      )
    );
  });

  // Every 2 minutes - process redemptions
  cron.schedule('*/2 * * * *', async () => {
    await Promise.all(
      chainHandlerRegistry.list().map(async (handler) =>
        cronConcurrencyLimit(async () => {
          const chainName = (handler as BaseChainHandler).config.chainName;
          try {
            const l2Service = l2RedemptionServices.get(chainName);
            if (!l2Service) {
              // If the service is not found, it means it failed during explicit initialization.
              // Log an error and skip processing for this chain in this cycle.
              logChainCronError(
                chainName,
                'redemption processing',
                new Error(`L2RedemptionService not found. It may have failed during initialization.`)
              );
              return; // Skip this chain for this cron cycle
            }
            await l2Service.processPendingRedemptions();
            await l2Service.processVaaFetchedRedemptions();
          } catch (error) {
            logChainCronError(chainName, 'redemption processing', error);
          }
        })
      )
    );
  });

  // Every 60 minutes - check for past deposits
  cron.schedule('*/60 * * * *', async () => {
    await Promise.all(
      chainHandlerRegistry.list().map(async (handler) =>
        cronConcurrencyLimit(async () => {
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
            logChainCronError(chainName, 'past deposits check', error);
          }
        })
      )
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
        logGlobalCronError('deposit cleanup', error);
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
        logGlobalCronError('redemption cleanup', error);
      }
    });
    logger.info('Cleanup cron jobs ENABLED.');
  } else {
    logger.info('Cleanup cron jobs DISABLED by environment variable ENABLE_CLEANUP_CRON.');
  }

  logger.debug('Multi-chain cron job setup complete.');
};

export async function initializeAllChains(
  chainHandlerRegistry: ChainHandlerRegistry
): Promise<ChainConfig[]> {
  const configs = await loadChainConfigs();
  loadedChainConfigs = configs; // Store loaded configs
  
  if (configs.length === 0) {
    logger.warn('No chain configurations loaded. Relayer might not operate on any chain.');
    return [];
  }
  logger.info(`Loaded ${configs.length} chain configurations: ${configs.map(c => c.chainName).join(', ')}`);
  // Pass the already loaded configs to initializeChainHandlers
  await initializeChainHandlers(chainHandlerRegistry, configs); 
  logger.info('All chain handlers registered and basic setup complete.');
  return configs;
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
        const service = await L2RedemptionService.create(config);
        l2RedemptionServices.set(config.chainName, service);
        logger.info(`L2RedemptionService initialized for chain: ${config.chainName}`);
      } catch (error) {
        // If a service fails, log and re-throw to halt startup.
        logger.error(`FATAL: Failed to initialize L2RedemptionService for ${config.chainName}:`, error);
        throw error; 
      }
    }
  }
  logger.info('All L2 Redemption Services initialized (or attempted and failed, halting startup).');
}
