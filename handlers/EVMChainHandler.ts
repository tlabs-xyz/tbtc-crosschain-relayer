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
  protected l2Provider: ethers.providers.JsonRpcProvider | undefined;
  protected l2Signer: ethers.Wallet | undefined;
  protected nonceManagerL2: NonceManager | undefined;
  protected l2BitcoinDepositor: ethers.Contract | undefined;
  protected l2BitcoinDepositorProvider: ethers.Contract | undefined;

  constructor(config: EvmChainConfig) {
    super(config);
  }

  protected async initializeL2(): Promise<void> {
    if (this.config.l2Rpc) {
      this.l2Provider = new ethers.providers.JsonRpcProvider(this.config.l2Rpc);

      if (this.config.privateKey) {
        this.l2Signer = new ethers.Wallet(this.config.privateKey, this.l2Provider);
        this.nonceManagerL2 = new NonceManager(this.l2Signer);
      }

      if (this.config.l2ContractAddress) {
        this.l2BitcoinDepositorProvider = new ethers.Contract(
          this.config.l2ContractAddress,
          L2BitcoinDepositorABI,
          this.l2Provider,
        );

        if (this.l2Signer) {
          this.l2BitcoinDepositor = new ethers.Contract(
            this.config.l2ContractAddress,
            L2BitcoinDepositorABI,
            this.nonceManagerL2,
          );
        }
      }
    } else {
      logger.warn(`EVM L2 RPC not configured for ${this.config.chainName}. L2 features disabled.`);
    }
  }

  protected async setupL2Listeners(): Promise<void> {
    if (!this.config.useEndpoint && this.l2BitcoinDepositorProvider) {
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
          try {
            const existingDeposit = await DepositStore.getById(depositId);
            if (existingDeposit) {
              logger.warn(
                `L2 Listener | Deposit already exists locally | ID: ${depositId}. Ignoring event.`,
              );
              return;
            }

            const deposit: Deposit = createDeposit(
              fundingTx,
              reveal,
              l2DepositOwner,
              l2Sender,
              this.config.chainName,
            );
            DepositStore.create(deposit);

            logger.info(`L2 Listener | Processing deposit | ID: ${deposit.id}`);
            await this.initializeDeposit(deposit);
          } catch (error: unknown) {
            logErrorContext(
              `L2 Listener | Error in DepositInitialized handler | ID: ${depositId}: ${error instanceof Error ? error.message : String(error)}`,
              error,
            );
            logDepositError(
              depositId,
              `Error processing L2 DepositInitialized event: ${error instanceof Error ? error.message : String(error)}`,
              error instanceof Error
                ? { message: error.message, stack: error.stack }
                : typeof error === 'object' && error !== null
                  ? (error as Record<string, unknown>)
                  : { message: String(error) },
              this.config.chainName,
            );
          }
        },
      );
      logger.info(`EVM L2 DepositInitialized listener active for ${this.config.chainName}`);
    } else if (this.config.useEndpoint) {
      logger.info(`EVM L2 Listeners skipped for ${this.config.chainName} (using Endpoint).`);
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
    } catch (error: unknown) {
      logErrorContext(
        `checkForPastDeposits | Error checking past EVM deposits for ${this.config.chainName}: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
      logDepositError(
        'past-check-evm',
        `Error checking past EVM deposits: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : typeof error === 'object' && error !== null
            ? (error as Record<string, unknown>)
            : { message: String(error) },
        this.config.chainName,
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
      return {
        startBlock: this.config.l2StartBlock ?? 0,
        endBlock: this.config.l2StartBlock ?? 0,
      };
    }

    const START_BLOCK = (this.config.l2StartBlock as number | undefined) ?? 0;
    let startBlock = -1;
    let low = START_BLOCK;
    let high = latestBlock;
    let currentLatestBlock = latestBlock;

    if (high < low) {
      logger.warn(
        `_getBlocksByTimestampEVM | latestBlock (${high}) is less than START_BLOCK (${low}). Returning START_BLOCK for both range ends.`,
      );
      return { startBlock: START_BLOCK, endBlock: START_BLOCK };
    }

    logger.debug(
      `_getBlocksByTimestampEVM | Starting binary search for timestamp ${timestamp} between blocks ${low} and ${high}`,
    );

    try {
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);

        const blockData = await this.l2Provider.getBlock(mid);

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

      if (startBlock === -1) {
        startBlock = START_BLOCK;
      }

      if (startBlock > currentLatestBlock) {
        startBlock = currentLatestBlock;
      }
    } catch (error) {
      logErrorContext(
        `_getBlocksByTimestampEVM | Error during binary search for ${this.config.chainName}: ${error}`,
        error,
      );
      startBlock = START_BLOCK;
      currentLatestBlock = latestBlock;
    }

    const endBlock = Math.max(startBlock, currentLatestBlock);

    logger.debug(
      `_getBlocksByTimestampEVM | Binary search result for ${this.config.chainName}: startBlock=${startBlock}, endBlock=${endBlock}`,
    );
    return { startBlock, endBlock };
  }
}
