import { ethers } from 'ethers';
import { NonceManager } from '@ethersproject/experimental';

import type { ChainHandlerInterface } from '../interfaces/ChainHandler.interface.js';
import type { EvmChainConfig } from '../config/schemas/evm.chain.schema.js';
import type { Deposit } from '../types/Deposit.type.js';
import type { FundingTransaction } from '../types/FundingTransaction.type.js';
import logger, { logErrorContext } from '../utils/Logger.js';
import { DepositStore } from '../utils/DepositStore.js';
import { createDeposit, getDepositId } from '../utils/Deposits.js';
import { getFundingTxHash } from '../utils/GetTransactionHash.js';

import { L2BitcoinDepositorABI } from '../interfaces/L2BitcoinDepositor.js';
import { logDepositError } from '../utils/AuditLog.js';

import { BaseChainHandler } from './BaseChainHandler.js';
import type { Reveal } from '../types/Reveal.type.js';

export class EVMChainHandler
  extends BaseChainHandler<EvmChainConfig>
  implements ChainHandlerInterface
{
  // --- Constants ---
  private static readonly DEFAULT_BLOCK_CHUNK_SIZE = 1000;

  protected l2Provider: ethers.providers.JsonRpcProvider | undefined;
  protected l2Signer: ethers.Wallet | undefined;
  protected nonceManagerL2: NonceManager | undefined;
  protected l2BitcoinDepositor: ethers.Contract | undefined;
  protected l2BitcoinDepositorProvider: ethers.Contract | undefined;

  constructor(config: EvmChainConfig) {
    super(config);
    logger.debug(`Constructing EVMChainHandler for ${this.config.chainName}`);
  }

  protected async initializeL2(): Promise<void> {
    logger.debug(`Initializing EVM L2 components for ${this.config.chainName}`);

    if (this.config.l2Rpc) {
      // Use simple configuration for provider setup
      this.l2Provider = new ethers.providers.JsonRpcProvider(this.config.l2Rpc);
      logger.debug(`EVM L2 Provider created for ${this.config.chainName}`);

      if (this.config.privateKey) {
        this.l2Signer = new ethers.Wallet(this.config.privateKey, this.l2Provider);
        this.nonceManagerL2 = new NonceManager(this.l2Signer);
        logger.debug(`EVM L2 Signer and NonceManager created for ${this.config.chainName}`);
      }

      if (this.config.l2ContractAddress) {
        if (this.nonceManagerL2) {
          this.l2BitcoinDepositor = new ethers.Contract(
            this.config.l2ContractAddress,
            L2BitcoinDepositorABI,
            this.nonceManagerL2,
          );
          logger.debug(
            `EVM L2 BitcoinDepositor contract (for txs) created for ${this.config.chainName}`,
          );
        }

        this.l2BitcoinDepositorProvider = new ethers.Contract(
          this.config.l2ContractAddress,
          L2BitcoinDepositorABI,
          this.l2Provider,
        );
        logger.debug(
          `EVM L2 BitcoinDepositorProvider contract (for events) created for ${this.config.chainName}`,
        );
      } else {
        logger.warn(
          `EVM L2 Contract Address not configured for ${this.config.chainName}. L2 contract features disabled.`,
        );
      }
    } else {
      logger.warn(`EVM L2 RPC not configured for ${this.config.chainName}. L2 features disabled.`);
    }
    logger.debug(`EVM L2 components initialization finished for ${this.config.chainName}`);
  }

  /**
   * Get gas configuration with enhanced settings
   */
  protected getGasConfiguration(): {
    gasLimit?: number;
    gasPrice?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
  } {
    return {}; // Return empty object for defaults
  }

  /**
   * Get transaction configuration with enhanced settings
   */
  protected getTransactionConfiguration(): {
    confirmations?: number;
    timeoutMs?: number;
    retryAttempts?: number;
    retryDelayMs?: number;
  } {
    return {
      confirmations: 1,
      timeoutMs: 60000,
      retryAttempts: 3,
      retryDelayMs: 1000,
    }; // Return sensible defaults
  }

  protected async setupL2Listeners(): Promise<void> {
    if (!this.isEndpointModeEnabled() && this.l2BitcoinDepositorProvider) {
      logger.debug(`Setting up EVM L2 listeners for ${this.config.chainName}`);

      this.l2BitcoinDepositorProvider.on(
        'DepositInitialized',
        async (
          fundingTx: FundingTransaction,
          reveal: Reveal,
          l2DepositOwner: string,
          l2Sender: string,
        ) => {
          const fundingTxHash = getFundingTxHash(fundingTx);
          const depositId = getDepositId(fundingTxHash, reveal.fundingOutputIndex);
          logger.debug(
            `Received L2 DepositInitialized event | ID: ${depositId} | Owner: ${l2DepositOwner}`,
          );
          try {
            const existingDeposit = await DepositStore.getById(depositId);
            if (existingDeposit) {
              logger.warn(
                `L2 Listener | Deposit already exists locally | ID: ${depositId}. Ignoring event.`,
              );
              return;
            }

            logger.debug(`L2 Listener | Creating new deposit | ID: ${depositId}`);
            const deposit: Deposit = createDeposit(
              fundingTx,
              reveal,
              l2DepositOwner,
              l2Sender,
              this.config.chainName,
            );
            DepositStore.create(deposit);

            logger.debug(`L2 Listener | Triggering L1 initializeDeposit | ID: ${deposit.id}`);
            await this.initializeDeposit(deposit);
          } catch (error: any) {
            logErrorContext(
              `L2 Listener | Error in DepositInitialized handler | ID: ${depositId}: ${error.message}`,
              error,
            );
            logDepositError(
              depositId,
              `Error processing L2 DepositInitialized event: ${error.message}`,
              error,
            );
          }
        },
      );
      logger.debug(`EVM L2 DepositInitialized listener is active for ${this.config.chainName}`);
    } else if (this.config.useEndpoint) {
      logger.debug(`EVM L2 Listeners skipped for ${this.config.chainName} (using Endpoint).`);
    } else {
      logger.warn(
        `EVM L2 Listeners skipped for ${this.config.chainName} (L2 provider/contract not configured).`,
      );
    }
  }

  async getLatestBlock(): Promise<number> {
    if (!this.l2Provider) {
      return 0;
    }
    try {
      const block = await this.l2Provider.getBlock('latest');
      return block.number;
    } catch (error) {
      logErrorContext(
        `getLatestBlock | Error fetching latest block for ${this.config.chainName}: ${error}`,
        error,
      );
      return 0;
    }
  }

  async checkForPastDeposits(options: {
    pastTimeInMinutes: number;
    latestBlock: number;
  }): Promise<void> {
    if (this.config.useEndpoint || !this.l2BitcoinDepositorProvider) {
      return;
    }

    logger.debug(
      `Checking for past EVM L2 deposits for ${this.config.chainName} (last ${options.pastTimeInMinutes} min)`,
    );
    try {
      const currentTime = Math.floor(Date.now() / 1000);
      const pastTime = currentTime - options.pastTimeInMinutes * 60;

      const { startBlock, endBlock } = await this._getBlocksByTimestampEVM(
        pastTime,
        options.latestBlock,
      );

      if (startBlock < 0 || endBlock < startBlock) {
        logger.warn(
          `checkForPastDeposits | Invalid block range calculated: [${startBlock}, ${endBlock}]. Skipping check.`,
        );
        return;
      }

      logger.debug(
        `checkForPastDeposits | Querying DepositInitialized events between blocks ${startBlock} and ${endBlock}`,
      );

      const events = await this.l2BitcoinDepositorProvider.queryFilter(
        this.l2BitcoinDepositorProvider.filters.DepositInitialized(),
        startBlock,
        endBlock,
      );

      if (events.length > 0) {
        logger.debug(
          `checkForPastDeposits | Found ${events.length} past DepositInitialized events for ${this.config.chainName}`,
        );

        for (const event of events) {
          if (!event.args) {
            logger.warn('checkForPastDeposits | Event args are undefined, skipping event');
            continue;
          }

          const { fundingTx, reveal, l2DepositOwner, l2Sender } = event.args;
          const fundingTxHash = getFundingTxHash(fundingTx as FundingTransaction);
          const depositId = getDepositId(fundingTxHash, reveal[0]);

          const existingDeposit = await DepositStore.getById(depositId);

          if (!existingDeposit) {
            logger.debug(`checkForPastDeposits | Processing missed deposit event: ${depositId}`);

            const newDeposit = createDeposit(
              fundingTx as FundingTransaction,
              reveal,
              l2DepositOwner,
              l2Sender,
              this.config.chainName,
            );
            DepositStore.create(newDeposit);

            await this.initializeDeposit(newDeposit);
          }
        }
      } else {
        logger.debug(
          `checkForPastDeposits | No missed deposit events found for ${this.config.chainName}`,
        );
      }
    } catch (error: any) {
      logErrorContext(
        `checkForPastDeposits | Error checking past EVM deposits for ${this.config.chainName}: ${error.message}`,
        error,
      );
      logDepositError(
        'past-check-evm',
        `Error checking past EVM deposits: ${error.message}`,
        error,
      );
    }
  }

  private async _getBlocksByTimestampEVM(
    timestamp: number,
    latestBlock: number,
  ): Promise<{
    startBlock: number;
    endBlock: number;
  }> {
    if (!this.l2Provider) {
      logger.warn(
        `_getBlocksByTimestampEVM | L2 Provider not available for ${this.config.chainName}. Returning default range.`,
      );
      return this.getDefaultBlockRange();
    }

    const { startBlock: START_BLOCK, low, high } = this.getBlockSearchRange(latestBlock);

    if (!this.isValidBlockRange(low, high, START_BLOCK)) {
      return { startBlock: START_BLOCK, endBlock: START_BLOCK };
    }

    logger.debug(
      `_getBlocksByTimestampEVM | Starting binary search for timestamp ${timestamp} between blocks ${low} and ${high}`,
    );

    const startBlock = await this.binarySearchBlockByTimestamp(timestamp, low, high, START_BLOCK);
    const endBlock = Math.max(startBlock, latestBlock);

    logger.debug(
      `_getBlocksByTimestampEVM | Binary search result for ${this.config.chainName}: startBlock=${startBlock}, endBlock=${endBlock}`,
    );
    return { startBlock, endBlock };
  }

  private getDefaultBlockRange(): { startBlock: number; endBlock: number } {
    const defaultBlock = this.config.l2StartBlock ?? 0;
    return {
      startBlock: defaultBlock,
      endBlock: defaultBlock,
    };
  }

  private getBlockSearchRange(latestBlock: number): {
    startBlock: number;
    low: number;
    high: number;
  } {
    const START_BLOCK = (this.config.l2StartBlock as number | undefined) ?? 0;
    return {
      startBlock: START_BLOCK,
      low: START_BLOCK,
      high: latestBlock,
    };
  }

  private isValidBlockRange(low: number, high: number, startBlock: number): boolean {
    if (high < low) {
      logger.warn(
        `_getBlocksByTimestampEVM | latestBlock (${high}) is less than START_BLOCK (${low}). Returning START_BLOCK for both range ends.`,
      );
      return false;
    }
    return true;
  }

  private async binarySearchBlockByTimestamp(
    timestamp: number,
    low: number,
    high: number,
    fallbackBlock: number,
  ): Promise<number> {
    let startBlock = -1;

    try {
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const blockData = await this.l2Provider!.getBlock(mid);

        if (!blockData) {
          high = mid - 1;
          continue;
        }

        if (blockData.timestamp === timestamp) {
          startBlock = mid;
          break;
        } else if (blockData.timestamp < timestamp) {
          startBlock = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      return startBlock === -1 ? fallbackBlock : Math.min(startBlock, high);
    } catch (error) {
      logErrorContext(
        `_getBlocksByTimestampEVM | Error during binary search for ${this.config.chainName}: ${error}`,
        error,
      );
      return fallbackBlock;
    }
  }
}
