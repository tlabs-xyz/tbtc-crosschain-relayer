// services/L2RedemptionService.ts - L2 Redemption Service for tBTC cross-chain relayer
//
// This service handles L2 redemption event listening, VAA fetching, and L1 submission for Bitcoin redemptions.
// It coordinates between L2 contracts, Wormhole VAA service, and L1 redemption handlers.

import * as AllEthers from 'ethers';
import type { ChainId } from '@wormhole-foundation/sdk';
import { WormholeVaaService } from './WormholeVaaService.js';
import { l1RedemptionHandlerRegistry } from '../handlers/L1RedemptionHandlerRegistry.js';
import type { L1RedemptionHandler } from '../handlers/L1RedemptionHandler.js';
import logger, { logErrorContext } from '../utils/Logger.js';
import { L2BitcoinRedeemerABI } from '../interfaces/L2BitcoinRedeemer.js';
import type {
  Redemption,
  RedemptionRequestedEventData,
  BitcoinTxUtxo,
} from '../types/Redemption.type.js';
import { RedemptionStatus } from '../types/Redemption.type.js';
import { RedemptionStore } from '../utils/RedemptionStore.js';
import type { EvmChainConfig } from '../config/schemas/evm.chain.schema.js';
import { toSerializableError } from '../types/Error.types.js';

// Import the default L1 chain ID constant
const DEFAULT_TARGET_L1_CHAIN_ID: ChainId = 2; // Ethereum Mainnet

export class L2RedemptionService {
  private l2Provider: AllEthers.providers.JsonRpcProvider;
  private l2BitcoinRedeemerContract?: AllEthers.Contract;
  private wormholeVaaService!: WormholeVaaService;
  private l1RedemptionHandler: L1RedemptionHandler;

  private l2WormholeChainId: number;
  private l2WormholeGatewayAddress: string; // Emitter address on L2 for VAA fetching
  private chainConfig: EvmChainConfig;

  // =====================
  // Initialization & Construction
  // =====================

  /**
   * Private constructor. Use L2RedemptionService.create() to instantiate.
   * @param chainConfig The EVM chain configuration
   */
  private constructor(chainConfig: EvmChainConfig) {
    this.chainConfig = chainConfig; // Store the chainConfig
    this.l2Provider = new AllEthers.providers.JsonRpcProvider(chainConfig.l2Rpc);

    if (chainConfig.l2BitcoinRedeemerAddress) {
      this.l2BitcoinRedeemerContract = new AllEthers.Contract(
        chainConfig.l2BitcoinRedeemerAddress,
        L2BitcoinRedeemerABI,
        this.l2Provider,
      );
      logger.info(
        `L2RedemptionService initialized for L2 contract ${chainConfig.l2BitcoinRedeemerAddress} on ${chainConfig.l2Rpc}. Listening for 'RedemptionRequested' event.`,
      );
    } else {
      logger.warn(
        `L2RedemptionService: l2BitcoinRedeemerAddress is not configured for chain ${chainConfig.chainName}. L2 redemption event listening will be disabled for this chain.`,
      );
    }

    this.l2WormholeChainId = chainConfig.l2WormholeChainId;
    this.l2WormholeGatewayAddress = chainConfig.l2WormholeGatewayAddress;
    this.l1RedemptionHandler = l1RedemptionHandlerRegistry.get(chainConfig);

    logger.info(
      `Wormhole VAA Service will be configured for L2 Wormhole Gateway: ${chainConfig.l2WormholeGatewayAddress} on chain ID: ${chainConfig.l2WormholeChainId}.`,
    );
    logger.info(
      `L1 Redemption Handler configured for L1BitcoinRedeemer: ${chainConfig.l1BitcoinRedeemerAddress} on ${chainConfig.l1Rpc}.`,
    );
  }

  /**
   * Async initialization for services that require await (e.g., WormholeVaaService).
   * @param chainConfig The EVM chain configuration
   */
  private async initialize(chainConfig: EvmChainConfig): Promise<void> {
    this.wormholeVaaService = await WormholeVaaService.create(chainConfig.l2Rpc);
  }

  /**
   * Factory method to create and initialize an L2RedemptionService instance.
   * @param chainConfig The EVM chain configuration
   * @returns A fully initialized L2RedemptionService
   */
  public static async create(chainConfig: EvmChainConfig): Promise<L2RedemptionService> {
    const instance = new L2RedemptionService(chainConfig);
    await instance.initialize(chainConfig);
    return instance;
  }

  // =====================
  // Event Listening
  // =====================

  /**
   * Start listening for 'RedemptionRequested' events on the L2 contract.
   */
  public startListening(): void {
    if (!this.l2BitcoinRedeemerContract) {
      logger.info(
        `Skipping 'RedemptionRequested' event listening for chain ${this.chainConfig.chainName} as l2BitcoinRedeemerAddress is not configured.`,
      );
      return;
    }
    if (!this.l2BitcoinRedeemerContract.interface.events['RedemptionRequested']) {
      logErrorContext(
        "L2 contract ABI does not seem to contain 'RedemptionRequested' event. Cannot listen for events.",
        new Error('Missing RedemptionRequested in ABI'),
      );
      return;
    }
    logger.info(
      `Starting to listen for 'RedemptionRequested' events from ${this.l2BitcoinRedeemerContract.address}`,
    );

    this.l2BitcoinRedeemerContract.on(
      'RedemptionRequested',
      async (
        walletPubKeyHash: string, // event.args[0] - bytes20
        mainUtxo: BitcoinTxUtxo, // event.args[1] - struct BitcoinTx.UTXO
        redeemerOutputScript: string, // event.args[2] - bytes
        amount: AllEthers.BigNumber, // event.args[3] - uint64
        rawEvent: AllEthers.Event, // The full event object from ethers.js
      ) => {
        try {
          const eventData: RedemptionRequestedEventData = {
            walletPubKeyHash,
            mainUtxo,
            redeemerOutputScript,
            amount,
            l2TransactionHash: rawEvent.transactionHash,
          };

          const redemptionId = eventData.l2TransactionHash;
          const existing = await RedemptionStore.getById(redemptionId);
          if (existing) {
            logger.info(`Redemption already exists for L2 tx: ${redemptionId}, skipping.`);
            return;
          }

          const now = Date.now();
          const redemption: Redemption = {
            id: redemptionId,
            chainId: this.chainConfig.chainName,
            event: eventData,
            vaaBytes: null,
            vaaStatus: RedemptionStatus.PENDING,
            l1SubmissionTxHash: null,
            status: RedemptionStatus.PENDING,
            error: null,
            dates: {
              createdAt: now,
              vaaFetchedAt: null,
              l1SubmittedAt: null,
              completedAt: null,
              lastActivityAt: now,
            },
            logs: [`Redemption created at ${new Date(now).toISOString()}`],
          };
          await RedemptionStore.create(redemption);
          logger.info(`Redemption request persisted for L2 tx: ${redemptionId}`);
        } catch (error: unknown) {
          logErrorContext(
            `Error processing RedemptionRequested event for tx ${rawEvent.transactionHash}:`,
            error,
          );
        }
      },
    );

    this.l2Provider.on('error', (error) => {
      logErrorContext('L2 Provider emitted an error:', error);
    });
  }

  /**
   * Stop listening for 'RedemptionRequested' events on the L2 contract.
   */
  public stopListening(): void {
    if (!this.l2BitcoinRedeemerContract) {
      logger.info(
        `Skipping stopListening for 'RedemptionRequested' events for chain ${this.chainConfig.chainName} as l2BitcoinRedeemerAddress is not configured.`,
      );
      return;
    }
    logger.info(
      `Stopping 'RedemptionRequested' event listener for ${this.l2BitcoinRedeemerContract.address}.`,
    );
    this.l2BitcoinRedeemerContract.removeAllListeners('RedemptionRequested');
  }

  // =====================
  // Redemption Processing
  // =====================

  /**
   * Process all pending and VAA_FAILED redemptions by fetching and verifying VAAs.
   */
  public async processPendingRedemptions(): Promise<void> {
    const pending = await RedemptionStore.getByStatus(
      RedemptionStatus.PENDING,
      this.chainConfig.chainName,
    );
    const vaaFailed = await RedemptionStore.getByStatus(
      RedemptionStatus.VAA_FAILED,
      this.chainConfig.chainName,
    );
    const toProcess = [...pending, ...vaaFailed];
    for (const redemption of toProcess) {
      try {
        const vaaDetails = await this.wormholeVaaService.fetchAndVerifyVaaForL2Event(
          redemption.id,
          this.l2WormholeChainId as ChainId,
          this.l2WormholeGatewayAddress,
          DEFAULT_TARGET_L1_CHAIN_ID,
        );
        if (vaaDetails && vaaDetails.vaaBytes) {
          redemption.vaaBytes = Buffer.from(vaaDetails.vaaBytes).toString('hex');
          redemption.vaaStatus = RedemptionStatus.VAA_FETCHED;
          redemption.status = RedemptionStatus.VAA_FETCHED;
          redemption.dates.vaaFetchedAt = Date.now();
          redemption.dates.lastActivityAt = Date.now();
          redemption.error = null;
          redemption.logs?.push(`VAA fetched at ${new Date().toISOString()}`);
          try {
            await RedemptionStore.update(redemption);
            logger.info(`VAA fetched and redemption updated: ${redemption.id}`);
          } catch (updateError: unknown) {
            logger.error(
              `Failed to update redemption ${redemption.id} after VAA fetch: ${toSerializableError(updateError).message}`,
            );
          }
        } else {
          redemption.vaaStatus = RedemptionStatus.VAA_FAILED;
          redemption.status = RedemptionStatus.VAA_FAILED;
          redemption.dates.lastActivityAt = Date.now();
          redemption.error = 'VAA fetch/verify failed';
          redemption.logs?.push(`VAA fetch failed at ${new Date().toISOString()}`);
          try {
            await RedemptionStore.update(redemption);
            logger.warn(`VAA fetch failed for redemption: ${redemption.id}`);
          } catch (updateError: unknown) {
            logger.error(
              `Failed to update redemption ${redemption.id} after VAA failure: ${toSerializableError(updateError).message}`,
            );
          }
        }
      } catch (error: unknown) {
        redemption.vaaStatus = RedemptionStatus.VAA_FAILED;
        redemption.status = RedemptionStatus.VAA_FAILED;
        redemption.dates.lastActivityAt = Date.now();
        redemption.error = toSerializableError(error).message;
        redemption.logs?.push(
          `VAA fetch error at ${new Date().toISOString()}: ${redemption.error}`,
        );
        try {
          await RedemptionStore.update(redemption);
          logger.error(`Error fetching VAA for redemption ${redemption.id}: ${redemption.error}`);
        } catch (updateError: unknown) {
          logger.error(
            `Failed to update redemption ${redemption.id} after VAA error: ${toSerializableError(updateError).message}`,
          );
        }
      }
    }
  }

  /**
   * Process all VAA_FETCHED redemptions by submitting them to L1.
   */
  public async processVaaFetchedRedemptions(): Promise<void> {
    const vaaFetched = await RedemptionStore.getByStatus(
      RedemptionStatus.VAA_FETCHED,
      this.chainConfig.chainName,
    );
    for (const redemption of vaaFetched) {
      try {
        if (!redemption.vaaBytes) {
          redemption.status = RedemptionStatus.FAILED;
          redemption.error = 'No VAA bytes present for L1 submission.';
          redemption.dates.lastActivityAt = Date.now();
          redemption.logs?.push(
            `L1 submission failed at ${new Date().toISOString()}: No VAA bytes.`,
          );
          try {
            await RedemptionStore.update(redemption);
            logger.error(`Redemption ${redemption.id} missing VAA bytes, cannot submit to L1.`);
          } catch (updateError: unknown) {
            logger.error(
              `Failed to update redemption ${redemption.id} after missing VAA bytes: ${toSerializableError(updateError).message}`,
            );
          }
          continue;
        }
        // Convert hex string to Uint8Array
        const vaaBytes = Buffer.from(redemption.vaaBytes, 'hex');
        const l1TxHash = await this.l1RedemptionHandler.submitRedemptionDataToL1(
          redemption.event,
          vaaBytes,
        );
        if (l1TxHash) {
          redemption.status = RedemptionStatus.COMPLETED;
          redemption.l1SubmissionTxHash = l1TxHash;
          redemption.dates.completedAt = Date.now();
          redemption.dates.l1SubmittedAt = Date.now();
          redemption.dates.lastActivityAt = Date.now();
          redemption.error = null;
          redemption.logs?.push(
            `L1 submission succeeded at ${new Date().toISOString()} (tx: ${l1TxHash})`,
          );
          try {
            await RedemptionStore.update(redemption);
            logger.info(
              `Redemption ${redemption.id} successfully submitted to L1 and marked COMPLETED. L1 tx: ${l1TxHash}`,
            );
          } catch (updateError: unknown) {
            logger.error(
              `Failed to update redemption ${redemption.id} after L1 success: ${toSerializableError(updateError).message}`,
            );
          }
        } else {
          redemption.status = RedemptionStatus.FAILED;
          redemption.dates.lastActivityAt = Date.now();
          redemption.error = 'L1 submission failed (see logs for details)';
          redemption.logs?.push(`L1 submission failed at ${new Date().toISOString()}`);
          try {
            await RedemptionStore.update(redemption);
            logger.error(`Redemption ${redemption.id} failed L1 submission.`);
          } catch (updateError: unknown) {
            logger.error(
              `Failed to update redemption ${redemption.id} after L1 failure: ${toSerializableError(updateError).message}`,
            );
          }
        }
      } catch (error: unknown) {
        redemption.status = RedemptionStatus.FAILED;
        redemption.dates.lastActivityAt = Date.now();
        redemption.error = toSerializableError(error).message;
        redemption.logs?.push(
          `L1 submission error at ${new Date().toISOString()}: ${redemption.error}`,
        );
        try {
          await RedemptionStore.update(redemption);
          logger.error(`Error submitting redemption ${redemption.id} to L1: ${redemption.error}`);
        } catch (updateError: unknown) {
          logger.error(
            `Failed to update redemption ${redemption.id} after L1 error: ${toSerializableError(updateError).message}`,
          );
        }
      }
    }
  }

  /**
   * Handle a RedemptionRequested event directly (used by tests).
   * @param walletPubKeyHash The wallet public key hash
   * @param mainUtxo The main Bitcoin UTXO
   * @param redeemerOutputScript The redeemer output script
   * @param amount The redemption amount
   * @param rawEvent The raw event object containing the transaction hash
   */
  public async handleRedemptionRequested(
    walletPubKeyHash: string,
    mainUtxo: BitcoinTxUtxo,
    redeemerOutputScript: string,
    amount: AllEthers.BigNumber,
    rawEvent: { transactionHash: string },
  ): Promise<void> {
    try {
      const eventData: RedemptionRequestedEventData = {
        walletPubKeyHash,
        mainUtxo,
        redeemerOutputScript,
        amount,
        l2TransactionHash: rawEvent.transactionHash,
      };

      const redemptionId = eventData.l2TransactionHash;
      const existing = await RedemptionStore.getById(redemptionId);
      if (existing) {
        logger.info(`Redemption already exists for L2 tx: ${redemptionId}, skipping.`);
        return;
      }

      const now = Date.now();
      const redemption: Redemption = {
        id: redemptionId,
        chainId: this.chainConfig.chainName,
        event: eventData,
        vaaBytes: null,
        vaaStatus: RedemptionStatus.PENDING,
        l1SubmissionTxHash: null,
        status: RedemptionStatus.PENDING,
        error: null,
        dates: {
          createdAt: now,
          vaaFetchedAt: null,
          l1SubmittedAt: null,
          completedAt: null,
          lastActivityAt: now,
        },
        logs: [`Redemption created at ${new Date(now).toISOString()}`],
      };
      await RedemptionStore.create(redemption);
      logger.info(`Redemption request persisted for L2 tx: ${redemptionId}`);
    } catch (error: unknown) {
      logErrorContext(
        `Error processing RedemptionRequested event for tx ${rawEvent.transactionHash}:`,
        error,
      );
    }
  }

  /**
   * Process VAA fetching for pending redemptions (used by tests).
   */
  public async processVaaFetching(): Promise<void> {
    await this.processPendingRedemptions();
  }

  /**
   * Process L1 submission for VAA-ready redemptions (used by tests).
   */
  public async processL1Submission(): Promise<void> {
    await this.processVaaFetchedRedemptions();
  }
}
