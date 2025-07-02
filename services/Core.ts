import logger, { logErrorContext } from '../utils/Logger.js';
import cron from 'node-cron';
import pLimit from 'p-limit';

import { chainHandlerRegistry } from '../handlers/ChainHandlerRegistry.js';
import { chainConfigs, type AnyChainConfig } from '../config/index.js';
import type { EvmChainConfig } from '../config/schemas/evm.chain.schema.js';
import {
  cleanQueuedDeposits,
  cleanFinalizedDeposits,
  cleanBridgedDeposits,
} from './CleanupDeposits.js';
import { L2RedemptionService } from './L2RedemptionService.js';
import { RedemptionStore } from '../utils/RedemptionStore.js';
import { RedemptionStatus } from '../types/Redemption.type.js';
import { BaseChainHandler } from '../handlers/BaseChainHandler.js';
import { CHAIN_TYPE } from '../config/schemas/common.schema.js';
import { l1RedemptionHandlerRegistry } from '../handlers/L1RedemptionHandlerRegistry.js';

let effectiveChainConfigs: AnyChainConfig[] = [];

const supportedChainsEnv = process.env.SUPPORTED_CHAINS;

if (supportedChainsEnv && supportedChainsEnv.trim() !== '') {
  const supportedChainKeys = supportedChainsEnv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (supportedChainKeys.length > 0) {
    logger.info(
      `SUPPORTED_CHAINS environment variable set. Attempting to load: ${supportedChainKeys.join(', ')}`,
    );
    supportedChainKeys.forEach((chainKey) => {
      const config = chainConfigs[chainKey];
      if (config) {
        effectiveChainConfigs.push(config);
      } else {
        logger.warn(
          `Configuration for chain key '${chainKey}' specified in SUPPORTED_CHAINS not found in loaded chainConfigs. Skipping.`,
        );
      }
    });

    if (effectiveChainConfigs.length === 0) {
      logger.error(
        'No valid chain configurations were loaded based on SUPPORTED_CHAINS. The relayer may not operate as expected. Please check your SUPPORTED_CHAINS environment variable and individual chain configuration files.',
      );
      // Consider process.exit(1) for non-test, non-API_ONLY_MODE environments
    }
  } else {
    logger.warn(
      'SUPPORTED_CHAINS environment variable is set but resulted in an empty list of chains after parsing. All loaded chain configurations will be used.',
    );
    effectiveChainConfigs = Object.values(chainConfigs).filter(
      (config): config is AnyChainConfig => config !== null && config !== undefined,
    );
  }
} else {
  logger.info(
    'SUPPORTED_CHAINS environment variable not set or is empty. All loaded chain configurations will be used.',
  );
  effectiveChainConfigs = Object.values(chainConfigs).filter(
    (config): config is AnyChainConfig => config !== null && config !== undefined,
  );
}

const chainConfigsArray: AnyChainConfig[] = effectiveChainConfigs;

const l2RedemptionServices: Map<string, L2RedemptionService> = new Map();

export async function processDeposits(): Promise<void> {
  logger.info('Processing deposits...');
  await Promise.all(
    chainHandlerRegistry.list().map(async (handler) => {
      const chainName = (handler as BaseChainHandler<AnyChainConfig>).config.chainName;
      try {
        await handler.processWormholeBridging?.();
        await handler.processFinalizeDeposits();
        await handler.processInitializeDeposits();
      } catch (error) {
        logErrorContext(`Error in deposit processing for ${chainName}:`, error);
      }
    }),
  );
}

export async function processRedemptions(): Promise<void> {
  logger.info('Processing redemptions...');
  await Promise.all(
    chainHandlerRegistry.list().map(async (handler) => {
      const config = (handler as BaseChainHandler<AnyChainConfig>).config;
      const chainName = config.chainName;
      try {
        const l2Service = l2RedemptionServices.get(chainName);

        if (l2Service) {
          await l2Service.processPendingRedemptions();
          await l2Service.processVaaFetchedRedemptions();
        } else {
          // No L2 service, check if it was expected
          if (config.enableL2Redemption) {
            logger.error(
              `L2 redemption is enabled for ${chainName}, but no L2RedemptionService was initialized. This could be a misconfiguration or an unsupported chain type for L2 redemption.`,
            );
          } else {
            // This is the expected path for chains without L2 redemption enabled (like Starknet by default)
            logger.info(`L2 redemption processing is disabled by configuration for ${chainName}.`);
          }
        }
      } catch (error) {
        logErrorContext(`Error in redemption processing for ${chainName}:`, error);
      }
    }),
  );
}

export async function checkForPastDepositsForAllChains(): Promise<void> {
  logger.info('Checking for past deposits...');
  await Promise.all(
    chainHandlerRegistry.list().map(async (handler) => {
      const chainName = (handler as BaseChainHandler<AnyChainConfig>).config.chainName;
      try {
        if (handler.supportsPastDepositCheck()) {
          const latestBlock = await handler.getLatestBlock();
          if (latestBlock > 0) {
            logger.debug(
              `Running checkForPastDeposits for ${chainName} (Latest Block/Slot: ${latestBlock})`,
            );
            await handler.checkForPastDeposits({
              pastTimeInMinutes: 60,
              latestBlock: latestBlock,
            });
          } else {
            logger.warn(
              `Skipping checkForPastDeposits for ${chainName} - Invalid latestBlock received: ${latestBlock}`,
            );
          }
        } else {
          logger.debug(
            `Skipping checkForPastDeposits for ${chainName} - Handler does not support it (e.g., using endpoint).`,
          );
        }
      } catch (error) {
        logErrorContext(`Error in past deposits check for ${chainName}:`, error);
      }
    }),
  );
}

export const startCronJobs = () => {
  logger.debug('Starting multi-chain cron job setup...');

  // Every minute - process deposits
  cron.schedule('* * * * *', async () => {
    await processDeposits();
  });

  // Every 2 minutes - process redemptions
  cron.schedule('*/2 * * * *', async () => {
    await processRedemptions();
  });

  // Every 60 minutes - check for past deposits
  cron.schedule('*/60 * * * *', async () => {
    await checkForPastDepositsForAllChains();
  });

  if (process.env.ENABLE_CLEANUP_CRON === 'true') {
    // Every 10 minutes - cleanup deposits
    cron.schedule('*/10 * * * *', async () => {
      try {
        await cleanQueuedDeposits();
        await cleanFinalizedDeposits();
        await cleanBridgedDeposits();
      } catch (error) {
        logErrorContext('Error in deposit cleanup cron job', error);
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
        logErrorContext('Error in redemption cleanup cron job', error);
      }
    });
    logger.info('Cleanup cron jobs ENABLED.');
  } else {
    logger.info('Cleanup cron jobs DISABLED by environment variable ENABLE_CLEANUP_CRON.');
  }

  logger.debug('Multi-chain cron job setup complete.');
};

export async function runStartupTasks(): Promise<void> {
  logger.info('Running startup tasks...');
  await Promise.all([processDeposits(), processRedemptions(), checkForPastDepositsForAllChains()]);
  logger.info('Startup tasks complete.');
}

export async function initializeAllChains(): Promise<void> {
  if (chainConfigsArray.length === 0) {
    logger.warn('No chain configurations loaded. Relayer might not operate on any chain.');
    return;
  }
  logger.info(
    `Loaded ${chainConfigsArray.length} chain configurations: ${chainConfigsArray
      .map((c) => c.chainName)
      .join(', ')}`,
  );

  await chainHandlerRegistry.initialize(chainConfigsArray);
  logger.info('ChainHandlerRegistry initialized for all chains.');

  // Initialize L1 Redemption Handler Registry
  try {
    await l1RedemptionHandlerRegistry.initialize(chainConfigsArray);
    logger.info('L1RedemptionHandlerRegistry initialized.');
  } catch (error) {
    logErrorContext(
      'Failed to initialize L1RedemptionHandlerRegistry. L2 redemptions may not be processed.',
      error,
    );
  }

  // Initialize handlers and setup listeners concurrently
  const initLimit = pLimit(5); // Limit concurrency for initialization
  const initializationPromises = chainHandlerRegistry.list().map((handler) =>
    initLimit(async () => {
      const chainName = (handler as BaseChainHandler<AnyChainConfig>).config.chainName as string;
      try {
        await handler.initialize();
        logger.info(`Successfully initialized handler for ${chainName}`);
        await handler.setupListeners();
        logger.info(`Successfully set up listeners for ${chainName}`);
      } catch (error: any) {
        logErrorContext(`Failed to initialize or set up listeners for ${chainName}:`, error);
        // Decide if we should exit or continue without this chain
        // For now, logging the error and continuing
      }
    }),
  );
  await Promise.all(initializationPromises);
  logger.info('All available chain handlers initialized and listeners set up.');
}

export async function initializeAllL2RedemptionServices(): Promise<void> {
  const evmChainConfigs = chainConfigsArray.filter(
    (config) => config.chainType === CHAIN_TYPE.EVM,
  ) as EvmChainConfig[];

  if (evmChainConfigs.length === 0) {
    logger.warn(
      'No EVM chain configurations found, L2RedemptionService will not be initialized for any chain.',
    );
    return;
  }

  logger.info('Initializing L2 Redemption Services for configured EVM chains...');
  for (const config of evmChainConfigs) {
    const chainName = config.chainName as string;
    if (config.enableL2Redemption) {
      if (!l2RedemptionServices.has(chainName)) {
        logger.info(`Initializing L2RedemptionService for ${chainName}...`);
        try {
          const service = await L2RedemptionService.create(config);
          await service.startListening(); // Start listening for events
          l2RedemptionServices.set(chainName, service);
          logger.info(`L2RedemptionService for ${chainName} initialized and listeners set up.`);
        } catch (error) {
          logErrorContext(`Failed to initialize L2RedemptionService for ${chainName}:`, error);
        }
      } else {
        logger.debug(`L2RedemptionService for ${chainName} already initialized.`);
      }
    } else {
      logger.info(`L2RedemptionService disabled for ${chainName} by configuration.`);
    }
  }
  logger.info('All L2 redemption services initialized (or skipped if disabled/not EVM).');
}

// Export for testing or specific access if needed, though registry is preferred
export function getL2RedemptionService(chainName: string): L2RedemptionService | undefined {
  return l2RedemptionServices.get(chainName);
}
