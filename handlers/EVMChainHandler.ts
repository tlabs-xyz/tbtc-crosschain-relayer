import { NonceManager } from '@ethersproject/experimental';
import type { TransactionReceipt } from '@ethersproject/providers';
import * as Sentry from '@sentry/node';
import { ethers } from 'ethers';
import { CHAIN_TYPE } from '../config/schemas/common.schema.js';
import type { EvmChainConfig } from '../config/schemas/evm.chain.schema.js';
import type { ChainHandlerInterface } from '../interfaces/ChainHandler.interface.js';
import { L2BitcoinDepositorABI } from '../interfaces/L2BitcoinDepositor.js';
import { L2WormholeGatewayABI } from '../interfaces/L2WormholeGateway.js';
import type { Deposit } from '../types/Deposit.type.js';
import { DepositStatus } from '../types/DepositStatus.enum.js';
import type { FundingTransaction } from '../types/FundingTransaction.type.js';
import type { Reveal } from '../types/Reveal.type.js';
import { logDepositError } from '../utils/AuditLog.js';
import { DepositStore } from '../utils/DepositStore.js';
import {
  createDeposit,
  getDepositId,
  updateToBridgedDeposit,
  updateToFinalizedAwaitingVAA,
} from '../utils/Deposits.js';
import { getFundingTxHash } from '../utils/GetTransactionHash.js';
import logger, { logErrorContext } from '../utils/Logger.js';
import { fetchVAAFromAPI } from '../utils/WormholeVAA.js';
import { BaseChainHandler, RECOVERY_DELAY_MS } from './BaseChainHandler.js';

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
            await DepositStore.create(deposit);

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
            await DepositStore.create(newDeposit);

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
   * excludes permanently failed deposits (receiveTbtc_reverted) and transient
   * failures still within the RECOVERY_DELAY_MS backoff window, filters out
   * those without a transfer sequence, and bridges each remaining deposit.
   */
  public async processWormholeBridging(): Promise<void> {
    const bridgingDeposits = await DepositStore.getByStatus(
      DepositStatus.AWAITING_WORMHOLE_VAA,
      this.config.chainName,
    );
    if (bridgingDeposits.length === 0) return;

    const now = Date.now();
    const eligibleDeposits = bridgingDeposits.filter((deposit) => {
      if (deposit.error === 'receiveTbtc_reverted') {
        logger.debug(`Skipping deposit ${deposit.id}: permanent error (receiveTbtc_reverted)`);
        return false;
      }
      if (
        deposit.error === 'bridging_exception' &&
        now - (deposit.dates?.lastActivityAt ?? 0) < RECOVERY_DELAY_MS
      ) {
        logger.debug(`Skipping deposit ${deposit.id}: transient error within backoff window`);
        return false;
      }
      return true;
    });

    for (const deposit of eligibleDeposits) {
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

      if (!vaaBase64 || vaaBase64.length === 0) {
        logger.warn(
          `VAA not yet available for deposit ${deposit.id}, sequence ${deposit.wormholeInfo.transferSequence}`,
        );
        return;
      }

      // Convert base64 VAA to bytes; a signed Wormhole VAA with 19 guardians
      // is ~500 bytes. Reject anything that looks implausibly small.
      const MIN_VAA_BYTES = 100;
      const vaaBuf = Buffer.from(vaaBase64, 'base64');
      if (vaaBuf.length < MIN_VAA_BYTES) {
        logger.warn(
          `VAA suspiciously short (${vaaBuf.length} bytes) for deposit ${deposit.id} — skipping`,
        );
        return;
      }
      const vaaBytes = '0x' + vaaBuf.toString('hex');

      logger.debug(`Submitting receiveTbtc transaction for deposit ${deposit.id}`, {
        depositId: deposit.id,
        vaaLength: vaaBuf.length,
        transferSequence: deposit.wormholeInfo.transferSequence,
      });

      const tx = await this.l2WormholeGateway.receiveTbtc(vaaBytes);
      const receipt = await tx.wait();

      if (!receipt || receipt.status !== 1) {
        const msg = `receiveTbtc transaction reverted for deposit ${deposit.id} (status=${receipt?.status ?? 'null'})`;
        logger.error(msg, { depositId: deposit.id, txHash: receipt?.transactionHash });
        Sentry.captureException(new Error(msg), {
          extra: {
            depositId: deposit.id,
            chainName: this.config.chainName,
            txHash: receipt?.transactionHash,
          },
        });
        // Persist error tag so the recovery cron skips this deposit instead of
        // retrying a permanently-failing revert on every tick.
        await DepositStore.update({
          ...deposit,
          error: 'receiveTbtc_reverted',
          dates: { ...deposit.dates, lastActivityAt: Date.now() },
        });
        return;
      }

      await updateToBridgedDeposit(deposit, receipt.transactionHash, CHAIN_TYPE.EVM);

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
      await DepositStore.update({
        ...deposit,
        error: 'bridging_exception',
        dates: { ...deposit.dates, lastActivityAt: Date.now() },
      });
    }
  }

  /**
   * Performs two recovery passes:
   *
   * **Pass 1 – AWAITING_WORMHOLE_VAA deposits:**
   * Re-attempts bridging for deposits that have been waiting longer than
   * RECOVERY_DELAY_MS. Deposits tagged with the permanent error
   * `receiveTbtc_reverted` are skipped. Transient errors (`bridging_exception`)
   * are retried after RECOVERY_DELAY_MS backoff via `lastActivityAt`.
   *
   * **Pass 2 – FINALIZED deposits with transferSequence_not_found:**
   * Re-fetches the finalization receipt from L1 and re-attempts to parse the
   * Wormhole `transferSequence`. If the sequence is found, the deposit is
   * transitioned directly to AWAITING_WORMHOLE_VAA so the normal bridging flow
   * can continue without manual intervention. Only when the receipt is
   * unavailable or the sequence still cannot be parsed is a one-time Sentry
   * alert fired. The error tag is updated afterward to prevent repeated alerts
   * on subsequent cron ticks.
   */
  public async recoverStuckFinalizedDeposits(): Promise<void> {
    const awaitingDeposits = await DepositStore.getByStatus(
      DepositStatus.AWAITING_WORMHOLE_VAA,
      this.config.chainName,
    );

    const now = Date.now();
    const stuckDeposits = awaitingDeposits.filter((deposit) => {
      if (deposit.error === 'receiveTbtc_reverted') return false;
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

    // Attempt to recover FINALIZED deposits whose transferSequence was never parsed
    // by re-fetching the finalization receipt and re-parsing it.
    // If recovery succeeds the deposit is transitioned to AWAITING_WORMHOLE_VAA so
    // the normal bridging flow can continue without manual intervention.
    // A Sentry alert is only fired when the receipt is unavailable or the transfer
    // sequence still cannot be found after the re-parse attempt. Each unrecoverable
    // deposit fires exactly one alert — the error tag is updated afterward to prevent
    // N × alerts-per-tick from exhausting Sentry quota.
    const finalizedDeposits = await DepositStore.getByStatus(
      DepositStatus.FINALIZED,
      this.config.chainName,
    );
    for (const deposit of finalizedDeposits) {
      if (deposit.error !== 'transferSequence_not_found') continue;
      if (!deposit.dates.finalizationAt) continue;
      if (now - deposit.dates.finalizationAt <= RECOVERY_DELAY_MS) continue;

      const finalizeTxHash = deposit.hashes?.eth?.finalizeTxHash;

      // Attempt to re-parse the transfer sequence from the finalization receipt.
      if (finalizeTxHash) {
        try {
          logger.info(
            `Attempting receipt re-parse for stuck FINALIZED deposit ${deposit.id} (tx: ${finalizeTxHash})`,
            { depositId: deposit.id, chainName: this.config.chainName, finalizeTxHash },
          );

          const receipt = await this.l1Provider.getTransactionReceipt(finalizeTxHash);

          if (receipt) {
            const { transferSequence, eventTxHash } = this.parseTransferSequenceFromReceipt(
              receipt,
              deposit.id,
            );

            if (transferSequence && eventTxHash) {
              await updateToFinalizedAwaitingVAA(deposit, eventTxHash, transferSequence);
              logger.info(
                `Recovered stuck FINALIZED deposit ${deposit.id} — transferSequence ${transferSequence} found via receipt re-parse`,
                { depositId: deposit.id, chainName: this.config.chainName, transferSequence },
              );
              continue; // Successfully recovered — skip the Sentry alert below.
            }

            logger.warn(
              `Receipt re-parse did not yield a transferSequence for deposit ${deposit.id} — falling back to Sentry alert`,
              { depositId: deposit.id, chainName: this.config.chainName, finalizeTxHash },
            );
          } else {
            logger.warn(
              `Could not fetch receipt for deposit ${deposit.id} (tx: ${finalizeTxHash}) — falling back to Sentry alert`,
              { depositId: deposit.id, chainName: this.config.chainName, finalizeTxHash },
            );
          }
        } catch (receiptError) {
          logErrorContext(
            `Error re-fetching receipt for deposit ${deposit.id} (tx: ${finalizeTxHash})`,
            receiptError,
          );
        }
      }

      // Recovery failed (no txHash, receipt unavailable, or sequence still missing) —
      // surface the issue via a one-time Sentry alert.
      const msg = `Deposit ${deposit.id} is stuck in FINALIZED with transferSequence_not_found — manual intervention required`;
      logger.error(msg, { depositId: deposit.id, chainName: this.config.chainName });
      Sentry.captureException(new Error(msg), {
        extra: {
          depositId: deposit.id,
          chainName: this.config.chainName,
          finalizeTxHash,
          finalizationAt: deposit.dates.finalizationAt,
        },
      });
      await DepositStore.update({
        ...deposit,
        error: 'transferSequence_not_found_alerted',
        dates: { ...deposit.dates, lastActivityAt: Date.now() },
      });
    }
  }

  override async finalizeDeposit(deposit: Deposit): Promise<TransactionReceipt | undefined> {
    if (!this.isDepositFinalizable(deposit)) return;

    const receipt = await this.submitFinalizationTx(deposit);

    if (receipt) {
      logger.info(`Processing EVM deposit finalization for ${deposit.id}...`);

      const { transferSequence, eventTxHash } = this.parseTransferSequenceFromReceipt(
        receipt,
        deposit.id,
      );

      if (transferSequence && eventTxHash) {
        await updateToFinalizedAwaitingVAA(deposit, receipt.transactionHash, transferSequence);
        logger.info(
          `Deposit ${deposit.id} now awaiting Wormhole VAA with sequence ${transferSequence}`,
        );
      } else {
        await this.handleMissingTransferSequence(deposit, receipt.transactionHash);
      }
    }

    return receipt;
  }
}
