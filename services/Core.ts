import { logErrorContext } from '../utils/Logger.js';
import cron from 'node-cron';

import logger from '../utils/Logger.js';
import { ChainHandlerFactory } from '../handlers/ChainHandlerFactory.js';
import { ChainConfig, ChainType } from '../types/ChainConfig.type.js';
import { L2RedemptionService } from './L2RedemptionService';
import {cleanQueuedDeposits, cleanFinalizedDeposits} from './CleanupDeposits';

// ---------------------------------------------------------------
// Environment Variables and Configuration
// ---------------------------------------------------------------
const requireEnv = (envVar: string) => {
  if (!process.env[envVar]) {
    logErrorContext(
      `Environment variable ${envVar} is not set.`,
      new Error(`Environment variable ${envVar} is not set.`)
    );
    process.exit(1);
  }
  return process.env[envVar] as string;
};

const chainConfig: ChainConfig = {
  chainType: (process.env.CHAIN_TYPE as ChainType) || ChainType.EVM,
  chainName: process.env.CHAIN_NAME || 'Default Chain',
  l1Rpc: requireEnv('L1_RPC'),
  l2Rpc: requireEnv('L2_RPC'),
  l1ContractAddress: requireEnv('L2_BITCOIN_DEPOSITOR'),
  l1BitcoinRedeemerAddress: requireEnv('L1_BITCOIN_REDEEMER_ADDRESS'),
  l2ContractAddress: requireEnv('L2_BITCOIN_DEPOSITOR'),
  l2BitcoinRedeemerAddress: requireEnv('L2_BITCOIN_REDEEMER_ADDRESS'),
  l2WormholeGatewayAddress: requireEnv('L2_WORMHOLE_GATEWAY_ADDRESS'),
  l2WormholeChainId: requireEnv('L2_WORMHOLE_CHAIN_ID'),
  vaultAddress: requireEnv('TBTCVault'),
  privateKey: requireEnv('PRIVATE_KEY'),
  useEndpoint: process.env.USE_ENDPOINT === 'true',
  endpointUrl: process.env.ENDPOINT_URL,
  l2StartBlock: process.env.L2_START_BLOCK
    ? parseInt(process.env.L2_START_BLOCK)
    : undefined,
};

// Create the appropriate chain handler
export const chainHandler = ChainHandlerFactory.createHandler(chainConfig);

// ---------------------------------------------------------------
// Cron Jobs
// ---------------------------------------------------------------

/**
 * @name startCronJobs
 * @description Starts the cron jobs for finalizing and initializing deposits.
 */
export const startCronJobs = () => {
  // CRONJOBS
  logger.debug('Starting cron job setup...');

  // Every minute - process deposits
  cron.schedule('* * * * *', async () => {
    try {
      await chainHandler.processFinalizeDeposits();
      await chainHandler.processInitializeDeposits();
    } catch (error) {
      logErrorContext('Error in deposit processing cron job:', error);
    }
  });

  // Every 5 minutes - check for past deposits
  cron.schedule('*/5 * * * *', async () => {
    try {
      if (chainHandler.supportsPastDepositCheck()) {
        const latestBlock = await chainHandler.getLatestBlock();
        if (latestBlock > 0) {
          logger.debug(
            `Running checkForPastDeposits (Latest Block/Slot: ${latestBlock})`
          );
          await chainHandler.checkForPastDeposits({
            pastTimeInMinutes: 5,
            latestBlock: latestBlock,
          });
        } else {
          logger.warn(
            `Skipping checkForPastDeposits - Invalid latestBlock received: ${latestBlock}`
          );
        }
      } else {
        logger.debug(
          'Skipping checkForPastDeposits - Handler does not support it (e.g., using endpoint).'
        );
      }
    } catch (error) {
      logErrorContext('Error in past deposits cron job:', error);
    }
  });

  // Every 10 minutes - cleanup
  cron.schedule('*/10 * * * *', async () => {
    try {
      await cleanQueuedDeposits();
      await cleanFinalizedDeposits();
    } catch (error) {
      logErrorContext('Error in cleanup cron job:', error);
    }
  });

  logger.debug('Cron job setup complete.');
};

/**
 * @name initializeChain
 * @description Initialize the chain handler and set up event listeners
 */
export const initializeChain = async () => {
  try {
    await chainHandler.initialize();
    await chainHandler.setupListeners();
    logger.debug(
      `Deposit chain handler for ${chainConfig.chainName} successfully initialized`
    );
  } catch (error) {
    logErrorContext('Failed to initialize deposit chain handler:', error);
    return false;
  }
  return true;
};

export const initializeL2RedemptionService = async () => {
  try {
    logger.info('Attempting to initialize L2RedemptionService...');
    const redemptionService = new L2RedemptionService(
      chainConfig.l2Rpc,
      chainConfig.l2BitcoinRedeemerAddress,
      chainConfig.privateKey,
      chainConfig.l1Rpc,
      chainConfig.l1BitcoinRedeemerAddress,
      Number(chainConfig.l2WormholeChainId),
      chainConfig.l2WormholeGatewayAddress
    );
    await redemptionService.initialize();
    redemptionService.startListening();
    logger.info('L2RedemptionService initialized and started successfully.');
  } catch (error) {
    logErrorContext(
      'Failed to initialize or start L2RedemptionService:',
      error as Error
    );
    return false;
  }
  return true;
};
