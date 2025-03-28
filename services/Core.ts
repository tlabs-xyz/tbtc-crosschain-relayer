import { BigNumber, ethers } from 'ethers';
import cron from 'node-cron';
import { NonceManager } from '@ethersproject/experimental';

import { L1BitcoinDepositorABI } from '../interfaces/L1BitcoinDepositor';
import { L2BitcoinDepositorABI } from '../interfaces/L2BitcoinDepositor';
import { getJsonById, writeNewJsonDeposit } from '../utils/JsonUtils';
import { createDeposit } from '../utils/Deposits';
import { Deposit } from '../types/Deposit.type';
import { LogMessage, LogError } from '../utils/Logs';
import { TBTCVaultABI } from '../interfaces/TBTCVault';
import { ChainHandlerFactory } from '../handlers/ChainHandlerFactory';
import { ChainConfig, ChainType } from '../types/ChainConfig.type';
import { cleanQueuedDeposits, cleanFinalizedDeposits } from './CleanupDeposits';

// ---------------------------------------------------------------
// Environment Variables and Configuration
// ---------------------------------------------------------------
const chainConfig: ChainConfig = {
  chainType: (process.env.CHAIN_TYPE as ChainType) || ChainType.EVM,
  chainName: process.env.CHAIN_NAME || 'Default Chain',
  l1Rpc: process.env.L1_RPC || '',
  l2Rpc: process.env.L2_RPC || '',
  l1ContractAddress: process.env.L1BitcoinDepositor || '',
  l2ContractAddress: process.env.L2BitcoinDepositor || '',
  vaultAddress: process.env.TBTCVault || '',
  privateKey: process.env.PRIVATE_KEY || '',
  useEndpoint: process.env.USE_ENDPOINT === 'true',
  endpointUrl: process.env.ENDPOINT_URL,
  l2StartBlock: process.env.L2_START_BLOCK
    ? parseInt(process.env.L2_START_BLOCK)
    : undefined,
};

// Create the appropriate chain handler
export const chainHandler = ChainHandlerFactory.createHandler(chainConfig);

// Constants
export const TIME_TO_RETRY = 1000 * 60 * 5; // 5 minutes

// ---------------------------------------------------------------
// Providers
// ---------------------------------------------------------------
export const providerL2: ethers.providers.JsonRpcProvider =
  new ethers.providers.JsonRpcProvider(chainConfig.l2Rpc);
export const providerL1: ethers.providers.JsonRpcProvider =
  new ethers.providers.JsonRpcProvider(chainConfig.l1Rpc);

// ---------------------------------------------------------------
// Signers
// ---------------------------------------------------------------
export const signerL2: ethers.Wallet = new ethers.Wallet(
  chainConfig.privateKey,
  providerL2
);
export const signerL1: ethers.Wallet = new ethers.Wallet(
  chainConfig.privateKey,
  providerL1
);

//NonceManager Wallets
export const nonceManagerL2 = new NonceManager(signerL2);
export const nonceManagerL1 = new NonceManager(signerL1);

// ---------------------------------------------------------------
// Contracts for signing transactions
// ---------------------------------------------------------------
export const L1BitcoinDepositor: ethers.Contract = new ethers.Contract(
  chainConfig.l1ContractAddress,
  L1BitcoinDepositorABI,
  nonceManagerL1
);

export const L2BitcoinDepositor: ethers.Contract = new ethers.Contract(
  chainConfig.l2ContractAddress,
  L2BitcoinDepositorABI,
  nonceManagerL2
);

export const TBTCVault: ethers.Contract = new ethers.Contract(
  chainConfig.vaultAddress,
  TBTCVaultABI,
  signerL1
);

// ---------------------------------------------------------------
// Contracts for event listening
// ---------------------------------------------------------------
const L1BitcoinDepositorProvider = new ethers.Contract(
  chainConfig.l1ContractAddress,
  L1BitcoinDepositorABI,
  providerL1
);

const L2BitcoinDepositorProvider = new ethers.Contract(
  chainConfig.l2ContractAddress,
  L2BitcoinDepositorABI,
  providerL2
);

const TBTCVaultProvider = new ethers.Contract(
  chainConfig.vaultAddress,
  TBTCVaultABI,
  providerL1
);

// ---------------------------------------------------------------
// Cron Jobs
// ---------------------------------------------------------------

/**
 * @name startCronJobs
 * @description Starts the cron jobs for finalizing and initializing deposits.
 */
export const startCronJobs = () => {
  // CRONJOBS
  LogMessage('Starting cron job setup...');

  // Every minute - process deposits
  cron.schedule('* * * * *', async () => {
    try {
      await chainHandler.processFinalizeDeposits();
      await chainHandler.processInitializeDeposits();
    } catch (error) {
      LogError('Error in deposit processing cron job:', error as Error);
    }
  });

  // Every 5 minutes - check for past deposits
  cron.schedule('*/5 * * * *', async () => {
    try {
      const latestBlock = await chainHandler.getLatestBlock();
      await chainHandler.checkForPastDeposits({
        pastTimeInMinutes: 5,
        latestBlock: latestBlock,
      });
    } catch (error) {
      LogError('Error in past deposits cron job:', error as Error);
    }
  });

  // Every 10 minutes - cleanup
  cron.schedule('*/10 * * * *', async () => {
    try {
      await cleanQueuedDeposits();
      await cleanFinalizedDeposits();
    } catch (error) {
      LogError('Error in cleanup cron job:', error as Error);
    }
  });

  LogMessage('Cron job setup complete.');
};

/**
 * @name initializeChain
 * @description Initialize the chain handler and set up event listeners
 */
export const initializeChain = async () => {
  try {
    // Initialize the chain handler
    await chainHandler.initialize();

    // Set up event listeners if not using endpoint
    if (!chainConfig.useEndpoint) {
      await chainHandler.setupListeners();
    }

    LogMessage(
      `Chain handler for ${chainConfig.chainName} successfully initialized`
    );
    return true;
  } catch (error) {
    LogError('Failed to initialize chain handler:', error as Error);
    return false;
  }
};

// ---------------------------------------------------------------
