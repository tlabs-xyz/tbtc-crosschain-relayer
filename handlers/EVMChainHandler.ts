import { ethers } from 'ethers';
import type { TransactionReceipt } from '@ethersproject/providers';
import { NonceManager } from '@ethersproject/experimental';

import type { ChainHandlerInterface } from '../interfaces/ChainHandler.interface.js';
import type { EvmChainConfig } from '../config/schemas/evm.chain.schema.js';
import type { Deposit } from '../types/Deposit.type.js';
import type { FundingTransaction } from '../types/FundingTransaction.type.js';
import logger, { logErrorContext } from '../utils/Logger.js';
import { DepositStore } from '../utils/DepositStore.js';
import {
  createDeposit,
  getDepositId,
  updateToAwaitingWormholeVAA,
  updateToFinalizedDeposit,
  updateToFinalizedAwaitingVAA,
  updateToBridgedDeposit,
} from '../utils/Deposits.js';
import { getFundingTxHash } from '../utils/GetTransactionHash.js';

import { L2BitcoinDepositorABI } from '../interfaces/L2BitcoinDepositor.js';
import { L2WormholeGatewayABI } from '../interfaces/L2WormholeGateway.js';
import { logDepositError } from '../utils/AuditLog.js';
import { DepositStatus } from '../types/DepositStatus.enum.js';
import { CHAIN_TYPE } from '../config/schemas/common.schema.js';

import { BaseChainHandler } from './BaseChainHandler.js';
import type { Reveal } from '../types/Reveal.type.js';
import { fetchVAAFromAPI } from '../utils/WormholeVAA.js';

const TOKENS_TRANSFERRED_SIG = ethers.utils.id(
  'TokensTransferredWithPayload(uint256,address,uint64)',
);

// Minimum time a deposit must be stuck before recovery is attempted
const RECOVERY_DELAY_MS = 5 * 60 * 1000; // 5 minutes

export class EVMChainHandler
  extends BaseChainHandler<EvmChainConfig>
  implements ChainHandlerInterface
{
  protected l2Provider: ethers.providers.JsonRpcProvider | undefined;
  protected l2Signer: ethers.Wallet | undefined;
  protected nonceManagerL2: NonceManager | undefined;
  protected l2BitcoinDepositor: ethers.Contract | undefined;
  protected l2BitcoinDepositorProvider: ethers.Contract | undefined;
  protected l2WormholeGateway: ethers.Contract | undefined;

  constructor(config: EvmChainConfig) {
    super(config);
    logger.debug(`Constructing EVMChainHandler for ${this.config.chainName}`);
  }

  protected override async initializeL2(): Promise<void> {
    logger.debug(`Initializing EVM L2 components for ${this.config.chainName}`);

    if (this.config.l2Rpc) {
      this.l2Provider = new ethers.providers.JsonRpcProvider(this.config.l2Rpc);
      logger.debug(`EVM L2 Provider created for ${this.config.chainName}`);

      if (this.config.privateKey) {
        this.l2Signer = new ethers.Wallet(this.config.privateKey, this.l2Provider);
        this.nonceManagerL2 = new NonceManager(this.l2Signer);
        logger.debug(`EVM L2 Signer and NonceManager created for ${this.config.chainName}`);
      }

      if (this.config.l2BitcoinDepositorAddress) {
        if (this.nonceManagerL2) {
          this.l2BitcoinDepositor = new ethers.Contract(
            this.config.l2BitcoinDepositorAddress,
            L2BitcoinDepositorABI,
            this.nonceManagerL2,
          );
          logger.debug(
            `EVM L2 BitcoinDepositor contract (for txs) created for ${this.config.chainName}`,
          );
        }

        this.l2BitcoinDepositorProvider = new ethers.Contract(
          this.config.l2BitcoinDepositorAddress,
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

      // Initialize L2WormholeGateway contract for Wormhole VAA bridging
      if (this.config.l2WormholeGatewayAddress && this.nonceManagerL2) {
        this.l2WormholeGateway = new ethers.Contract(
          this.config.l2WormholeGatewayAddress,
          L2WormholeGatewayABI,
          this.nonceManagerL2,
        );
        logger.debug(`EVM L2WormholeGateway contract created for ${this.config.chainName}`);
      }
    } else {
      logger.warn(`EVM L2 RPC not configured for ${this.config.chainName}. L2 features disabled.`);
    }
    logger.debug(`EVM L2 components initialization finished for ${this.config.chainName}`);
  }

  protected override async setupL2Listeners(): Promise<void> {
    if (!this.config.useEndpoint && this.l2BitcoinDepositorProvider) {
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

  override async getLatestBlock(): Promise<number> {
    if (!this.l2Provider) {
      logger.warn(`Latest block for ${this.config.chainName}: 0`);
      return 0;
    }
    try {
      const block = await this.l2Provider.getBlock('latest');
      logger.debug(`Latest block for ${this.config.chainName}: ${block.number}`);
      return block.number;
    } catch (error) {
      logErrorContext(
        `getLatestBlock | Error fetching latest block for ${this.config.chainName}: ${error}`,
        error,
      );
      return 0;
    }
  }

  override async checkForPastDeposits(options: {
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
      return {
        startBlock: this.config.l2BitcoinDepositorStartBlock ?? 0,
        endBlock: latestBlock ?? 0,
      };
    }

    const START_BLOCK = (this.config.l2BitcoinDepositorStartBlock as number | undefined) ?? 0;
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
      // Binary search for the block with the closest timestamp to the given timestamp
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);

        const blockData = await this.l2Provider.getBlock(mid);

        if (blockData) {
          if (blockData.timestamp === timestamp) {
            startBlock = mid;
            break;
          } else if (blockData.timestamp < timestamp) {
            startBlock = mid;
            low = mid + 1;
          } else {
            high = mid - 1;
          }
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

  /**
   * Processes all deposits awaiting Wormhole VAA bridging on this EVM chain.
   * Queries DepositStore for deposits with AWAITING_WORMHOLE_VAA status,
   * filters out those without a transfer sequence, and bridges each one.
   */
  public async processWormholeBridging(): Promise<void> {
    if (this.config.chainType !== CHAIN_TYPE.EVM) return;

    const bridgingDeposits = await DepositStore.getByStatus(
      DepositStatus.AWAITING_WORMHOLE_VAA,
      this.config.chainName,
    );
    if (bridgingDeposits.length === 0) return;

    for (const deposit of bridgingDeposits) {
      if (!deposit.wormholeInfo || !deposit.wormholeInfo.transferSequence) {
        logger.warn(`Deposit ${deposit.id} is missing transferSequence. Skipping.`);
        continue;
      }
      await this.bridgeEvmDeposit(deposit);
    }
  }

  /**
   * Bridges a single EVM deposit by fetching the Wormhole VAA and calling
   * receiveTbtc on the L2WormholeGateway contract. Updates the deposit
   * status to BRIDGED on success.
   */
  public async bridgeEvmDeposit(deposit: Deposit): Promise<void> {
    if (deposit.status !== DepositStatus.AWAITING_WORMHOLE_VAA) return;

    if (!this.l2WormholeGateway) {
      logger.warn(`L2WormholeGateway not initialized. Cannot bridge deposit ${deposit.id}.`);
      return;
    }

    try {
      if (!deposit.wormholeInfo?.transferSequence) {
        logger.warn(`No transfer sequence for deposit ${deposit.id}`);
        return;
      }

      logger.info(`Bridging EVM deposit ${deposit.id}...`);
      logger.info(
        `Using sequence ${deposit.wormholeInfo.transferSequence} from L1 tx ${deposit.wormholeInfo.txHash}`,
      );

      const vaaBase64 = await fetchVAAFromAPI(
        deposit.wormholeInfo.transferSequence,
        this.config.network,
      );

      if (!vaaBase64) {
        logger.warn(
          `VAA not yet available for deposit ${deposit.id}, sequence ${deposit.wormholeInfo.transferSequence}`,
        );
        return;
      }

      // Convert base64 VAA to hex-encoded bytes for the EVM contract call
      const vaaBytes = '0x' + Buffer.from(vaaBase64, 'base64').toString('hex');

      logger.debug(`Submitting receiveTbtc transaction for deposit ${deposit.id}`, {
        depositId: deposit.id,
        vaaLength: vaaBytes.length,
        transferSequence: deposit.wormholeInfo.transferSequence,
      });

      const tx = await this.l2WormholeGateway.receiveTbtc(vaaBytes);
      const receipt = await tx.wait();

      await updateToBridgedDeposit(deposit, receipt.transactionHash);

      logger.info(`EVM bridging completed successfully for deposit ${deposit.id}`, {
        depositId: deposit.id,
        transactionHash: receipt.transactionHash,
        transferSequence: deposit.wormholeInfo.transferSequence,
      });
    } catch (error: any) {
      const reason = error.message || 'Unknown bridging error';
      logger.warn(`Wormhole bridging failed for deposit ${deposit.id}: ${reason}`, {
        depositId: deposit.id,
        transferSequence: deposit.wormholeInfo?.transferSequence,
        errorType: error.constructor.name,
        errorMessage: error.message,
        stack: error.stack,
      });
    }
  }

  /**
   * Recovers deposits stuck in FINALIZED or AWAITING_WORMHOLE_VAA status.
   * For FINALIZED deposits: searches L1 blocks for the TokensTransferredWithPayload
   * event to extract the transfer sequence and transition to AWAITING_WORMHOLE_VAA.
   * For AWAITING_WORMHOLE_VAA deposits: re-attempts bridging via bridgeEvmDeposit().
   * Both scenarios enforce a minimum delay before recovery to avoid racing with
   * normal processing pipelines.
   */
  public async recoverStuckFinalizedDeposits(deposits: Deposit[]): Promise<void> {
    if (deposits && deposits.length > 0) {
      await this.recoverFinalizedDeposits(deposits);
    }

    await this.recoverAwaitingDeposits();
  }

  /**
   * Recovers deposits stuck in FINALIZED status by searching L1 blocks for the
   * TokensTransferredWithPayload event. Uses the finalize tx hash when available
   * for precise block lookup, or falls back to timestamp-based estimation.
   * Performs a wider search if the initial scan finds no results.
   */
  private async recoverFinalizedDeposits(deposits: Deposit[]): Promise<void> {
    logger.info(
      `Attempting to recover ${deposits.length} stuck finalized deposits for ${this.config.chainName}`,
    );

    const now = Date.now();
    const stuckDeposits = deposits.filter((deposit) => {
      if (!deposit.dates.finalizationAt) return false;
      return now - deposit.dates.finalizationAt > RECOVERY_DELAY_MS;
    });

    if (stuckDeposits.length === 0) {
      logger.debug(`No deposits have been finalized long enough for recovery`);
      return;
    }

    logger.info(`Found ${stuckDeposits.length} deposits finalized more than 5 minutes ago`);

    for (const deposit of stuckDeposits) {
      try {
        logger.info(`Attempting recovery for deposit ${deposit.id}`);

        const searchStartBlock = await this.resolveSearchStartBlock(deposit);
        if (searchStartBlock === null) continue;

        const searchResult =
          (await this.searchForTransferSequence(deposit, searchStartBlock)) ??
          (await this.searchForTransferSequence(deposit, searchStartBlock - 10, 30));

        if (searchResult) {
          await updateToAwaitingWormholeVAA(searchResult.txHash, deposit, searchResult.sequence);
          logger.info(
            `Successfully recovered deposit ${deposit.id} - updated to AWAITING_WORMHOLE_VAA with sequence ${searchResult.sequence}`,
          );
        } else {
          logger.warn(
            `Could not find transfer sequence for deposit ${deposit.id} even with wider search`,
          );
        }
      } catch (error) {
        logErrorContext(`Error recovering deposit ${deposit.id}`, error);
      }
    }
  }

  /**
   * Determines the L1 block number to start searching for the transfer sequence.
   * Uses the finalize tx receipt when a hash is available; otherwise estimates
   * the block from the finalization timestamp using the average L1 block time.
   * Returns null if the starting block cannot be determined.
   */
  private async resolveSearchStartBlock(deposit: Deposit): Promise<number | null> {
    if (deposit.hashes?.eth?.finalizeTxHash) {
      const receipt = await this.l1Provider.getTransactionReceipt(
        deposit.hashes.eth.finalizeTxHash,
      );
      if (!receipt) {
        logger.warn(`Could not get finalization receipt for deposit ${deposit.id}`);
        return null;
      }
      return receipt.blockNumber;
    }

    logger.info(`Deposit ${deposit.id} missing finalization tx hash, estimating search block...`);

    const currentBlock = await this.l1Provider.getBlockNumber();
    const currentTimestamp = (await this.l1Provider.getBlock(currentBlock)).timestamp;

    const finalizationTimestamp = Math.floor(deposit.dates.finalizationAt! / 1000);
    const secondsAgo = currentTimestamp - finalizationTimestamp;
    const ETHEREUM_BLOCK_TIME_SECONDS = 12;
    const blocksAgo = Math.floor(secondsAgo / ETHEREUM_BLOCK_TIME_SECONDS);
    const startBlock = Math.max(1, currentBlock - blocksAgo);

    logger.info(`Estimated search start block: ${startBlock} for deposit ${deposit.id}`);
    return startBlock;
  }

  /**
   * Fetches deposits stuck in AWAITING_WORMHOLE_VAA status for this chain
   * and re-attempts bridging for those past the recovery delay threshold.
   */
  private async recoverAwaitingDeposits(): Promise<void> {
    const awaitingDeposits = await DepositStore.getByStatus(
      DepositStatus.AWAITING_WORMHOLE_VAA,
      this.config.chainName,
    );

    const now = Date.now();
    const stuckDeposits = awaitingDeposits.filter((deposit) => {
      const awaitingSince =
        deposit.dates.awaitingWormholeVAAMessageSince ?? deposit.dates.finalizationAt;
      if (!awaitingSince) return false;
      return now - awaitingSince > RECOVERY_DELAY_MS;
    });

    for (const deposit of stuckDeposits) {
      try {
        logger.info(`Re-attempting bridging for AWAITING deposit ${deposit.id}`);
        await this.bridgeEvmDeposit(deposit);
      } catch (error) {
        logErrorContext(`Error re-bridging deposit ${deposit.id}`, error);
      }
    }
  }

  /**
   * Searches a range of L1 blocks for the TokensTransferredWithPayload event
   * emitted by the L1BitcoinDepositor contract. Returns the transfer sequence
   * and transaction hash if found, or null otherwise.
   */
  private async searchForTransferSequence(
    deposit: Deposit,
    startBlock: number,
    searchBlocks: number = 5,
  ): Promise<{ sequence: string; txHash: string } | null> {
    try {
      const endBlock = Math.min(startBlock + searchBlocks, await this.l1Provider.getBlockNumber());

      logger.debug(
        `Searching for TokensTransferredWithPayload events in blocks ${startBlock}-${endBlock} for deposit ${deposit.id}`,
      );

      const logs = await this.l1Provider.getLogs({
        topics: [TOKENS_TRANSFERRED_SIG],
        fromBlock: startBlock,
        toBlock: endBlock,
      });

      logger.debug(
        `Found ${logs.length} TokensTransferredWithPayload events in blocks ${startBlock}-${endBlock}`,
      );

      // Filter to events from the L1BitcoinDepositor contract
      const l1BitcoinDepositorAddress = this.config.l1BitcoinDepositorAddress.toLowerCase();

      for (const log of logs) {
        try {
          if (log.address.toLowerCase() === l1BitcoinDepositorAddress) {
            const parsedLog = this.l1BitcoinDepositorProvider.interface.parseLog(log);

            if (parsedLog.args.transferSequence) {
              // Correlate event to the specific deposit by matching l2Receiver
              const eventReceiver = parsedLog.args.l2Receiver;
              if (eventReceiver && eventReceiver.toLowerCase() !== deposit.owner.toLowerCase()) {
                logger.debug(
                  `Event l2Receiver ${eventReceiver} does not match deposit owner ${deposit.owner} for deposit ${deposit.id}, skipping`,
                );
                continue;
              }

              logger.info(
                `Found transfer sequence ${parsedLog.args.transferSequence} from L1BitcoinDepositor in tx ${log.transactionHash}`,
              );

              return {
                sequence: parsedLog.args.transferSequence.toString(),
                txHash: log.transactionHash,
              };
            }
          }
        } catch (error) {
          logger.debug(`Failed to parse log: ${error}`);
        }
      }

      logger.debug(
        `No transfer sequence found from L1BitcoinDepositor in blocks ${startBlock}-${endBlock} for deposit ${deposit.id}`,
      );
      return null;
    } catch (error) {
      logErrorContext(`Error searching for transfer sequence`, error);
      return null;
    }
  }

  override async finalizeDeposit(deposit: Deposit): Promise<TransactionReceipt | undefined> {
    const receipt = await this.submitFinalizationTx(deposit);

    if (receipt) {
      logger.info(`Processing EVM deposit finalization for ${deposit.id}...`);

      const { transferSequence, eventTxHash } = this.parseTransferSequenceFromReceipt(
        receipt,
        deposit.id,
      );

      if (transferSequence && eventTxHash) {
        await updateToFinalizedAwaitingVAA(deposit, receipt.transactionHash, eventTxHash, transferSequence);
        logger.info(
          `Deposit ${deposit.id} now awaiting Wormhole VAA with sequence ${transferSequence}`,
        );
      } else {
        await updateToFinalizedDeposit(deposit, receipt, 'transferSequence_not_found');
        logger.error(
          `Could not parse transferSequence for deposit ${deposit.id} — finalizeTxHash stored, manual intervention required`,
        );
      }
    }

    return receipt;
  }

  /**
   * Searches receipt logs for the TokensTransferredWithPayload event emitted by
   * the L1BitcoinDepositor contract. Returns the transfer sequence and transaction
   * hash on success, or nulls if not found.
   */
  private parseTransferSequenceFromReceipt(
    receipt: TransactionReceipt,
    depositId: string,
  ): { transferSequence: string | null; eventTxHash: string | null } {
    try {
      const l1BitcoinDepositorAddress = this.config.l1BitcoinDepositorAddress.toLowerCase();
      const logs = (receipt.logs || []).filter(
        (log) =>
          log.address.toLowerCase() === l1BitcoinDepositorAddress &&
          log.topics[0] === TOKENS_TRANSFERRED_SIG,
      );
      for (const log of logs) {
        try {
          const parsedLog = this.l1BitcoinDepositorProvider.interface.parseLog(log);
          if (parsedLog.name === 'TokensTransferredWithPayload' && parsedLog.args.transferSequence) {
            const transferSequence = parsedLog.args.transferSequence.toString();
            logger.info(`Found transfer sequence ${transferSequence} in receipt for deposit ${depositId}`);
            return { transferSequence, eventTxHash: receipt.transactionHash };
          }
        } catch (error) {
          logger.warn(`Failed to parse TokensTransferredWithPayload log for deposit ${depositId}: ${error}`);
        }
      }
    } catch (error: any) {
      logErrorContext(`Error parsing L1 logs for deposit ${depositId}`, error);
    }
    return { transferSequence: null, eventTxHash: null };
  }
}
