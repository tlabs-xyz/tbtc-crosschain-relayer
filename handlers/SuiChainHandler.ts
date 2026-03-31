import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromBase64 } from '@mysten/bcs';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import type { SuiEvent, SuiEventFilter } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import type { Chain, ChainContext, TBTCBridge } from '@wormhole-foundation/sdk-connect';
import { ethers } from 'ethers';
import type { TransactionReceipt } from '@ethersproject/providers';

import { CHAIN_TYPE } from '../config/schemas/common.schema.js';
import type { SuiChainConfig } from '../config/schemas/sui.chain.schema.js';
import logger, { logErrorContext } from '../utils/Logger.js';
import { logDepositError } from '../utils/AuditLog.js';
import * as Sentry from '@sentry/node';
import { BaseChainHandler } from './BaseChainHandler.js';
import { fetchVAAFromAPI } from '../utils/WormholeVAA.js';
import { type Deposit } from '../types/Deposit.type.js';
import { DepositStatus } from '../types/DepositStatus.enum.js';
import {
  updateToFinalizedDeposit,
  updateToFinalizedAwaitingVAA,
  updateToBridgedDeposit,
  createDeposit,
} from '../utils/Deposits.js';
import { DepositStore } from '../utils/DepositStore.js';
import { parseDepositInitializedEvent } from '../utils/SuiMoveEventParser.js';


/**
 * Chain handler for SUI blockchain integration.
 * Handles SUI L2 operations including deposit processing, event monitoring, and Wormhole bridging.
 */
export class SuiChainHandler extends BaseChainHandler<SuiChainConfig> {
  private suiClient: SuiClient | undefined;
  private keypair: Ed25519Keypair | undefined;
  private suiWormholeContext: ChainContext<'Mainnet' | 'Testnet' | 'Devnet', Chain>;

  constructor(config: SuiChainConfig) {
    super(config);
    logger.debug(`Constructing SuiChainHandler for ${this.config.chainName}`);
    if (config.chainType !== CHAIN_TYPE.SUI) {
      throw new Error(`Incorrect chain type ${config.chainType} provided to SuiChainHandler.`);
    }
  }

  protected override async initializeL2(): Promise<void> {
    logger.debug(`Initializing Sui L2 components for ${this.config.chainName}`);

    if (!this.config.l2Rpc) {
      logger.warn(`Sui L2 RPC not configured for ${this.config.chainName}. L2 features disabled.`);
      return;
    }

    try {
      // Initialize SUI client
      this.suiClient = new SuiClient({ url: this.config.l2Rpc });

      // Initialize keypair - support both base64 and Bech32 formats
      if (this.config.suiPrivateKey.startsWith('suiprivkey1')) {
        // Handle Bech32-encoded private key
        const decoded = decodeSuiPrivateKey(this.config.suiPrivateKey);
        this.keypair = Ed25519Keypair.fromSecretKey(decoded.secretKey);
      } else {
        // Handle base64-encoded private key
        const privateKeyBytes = fromBase64(this.config.suiPrivateKey);
        this.keypair = Ed25519Keypair.fromSecretKey(privateKeyBytes);
      }

      // Get SUI Wormhole context for cross-chain operations
      this.suiWormholeContext = this.wormhole.getChain('Sui' as Chain);

      logger.info(`Sui L2 client initialized for ${this.config.chainName}`);
      logger.info(`SUI address: ${this.keypair.getPublicKey().toSuiAddress()}`);
    } catch (error: any) {
      logErrorContext(`Failed to initialize Sui L2 client for ${this.config.chainName}`, error);
      throw error;
    }
  }

  private pollingInterval: NodeJS.Timeout | null = null;
  private lastEventCursor: string | null = null;

  protected override async setupL2Listeners(): Promise<void> {
    logger.info(
      `Setting up L2 listeners for ${this.config.chainName}, useEndpoint: ${this.config.useEndpoint}, suiClient: ${!!this.suiClient}`,
    );

    if (this.config.useEndpoint || !this.suiClient) {
      logger.info(
        `Sui L2 Listeners skipped for ${this.config.chainName} (using Endpoint: ${this.config.useEndpoint} or client not initialized: ${!this.suiClient}).`,
      );
      return;
    }

    try {
      // SUI doesn't support WebSocket subscriptions, so we use polling
      const POLLING_INTERVAL_MS = 5000; // Poll every 5 seconds

      const eventFilter: SuiEventFilter = {
        MoveModule: {
          package: this.config.l2PackageId,
          module: 'BitcoinDepositor',
        },
      };

      // Start polling for events
      this.pollingInterval = setInterval(async () => {
        try {
          logger.debug(
            `Polling SUI events for ${this.config.chainName}, cursor: ${this.lastEventCursor || 'null'}`,
            {
              eventFilter: eventFilter,
              l2PackageId: this.config.l2PackageId,
              l2ContractAddress: this.config.l2BitcoinDepositorAddress,
            },
          );

          if (!this.suiClient) return;
          const response = await this.suiClient.queryEvents({
            query: eventFilter,
            cursor: this.lastEventCursor as any,
            limit: 50,
            order: 'ascending',
          });

          logger.debug(
            `SUI event query response for ${this.config.chainName}: ${response.data.length} events, hasNextPage: ${response.hasNextPage}`,
            {
              cursor: this.lastEventCursor,
              nextCursor: response.nextCursor,
              hasNextPage: response.hasNextPage,
              responseDataLength: response.data?.length || 0,
              responseKeys: Object.keys(response || {}),
            },
          );

          if (response.data.length > 0) {
            logger.info(
              `Found ${response.data.length} new SUI events for ${this.config.chainName}`,
            );

            for (const event of response.data) {
              await this.handleSuiDepositEvent(event);
            }

            // Update cursor after processing events to avoid reprocessing the same events
            // This should be done whenever we have a nextCursor, regardless of hasNextPage
            if (response.nextCursor) {
              this.lastEventCursor = response.nextCursor as any;
              logger.debug(
                `Updated SUI event cursor for ${this.config.chainName}: ${this.lastEventCursor}`,
              );
            }
          }
        } catch (error: any) {
          logErrorContext(`Error polling SUI events for ${this.config.chainName}`, error);
        }
      }, POLLING_INTERVAL_MS);

      logger.info(
        `Sui L2 event polling started for ${this.config.chainName} (interval: ${POLLING_INTERVAL_MS}ms)`,
      );
    } catch (error: any) {
      logErrorContext(`Failed to setup Sui L2 listeners for ${this.config.chainName}`, error);
      throw error;
    }
  }

  // Add cleanup method to stop polling
  async cleanup(): Promise<void> {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      logger.info(`Stopped SUI event polling for ${this.config.chainName}`);
    }
  }

  override async getLatestBlock(): Promise<number> {
    if (this.config.useEndpoint || !this.suiClient) {
      return 0;
    }

    try {
      const checkpoint = await this.suiClient.getLatestCheckpointSequenceNumber();
      return Number(checkpoint);
    } catch (error: any) {
      logErrorContext(`Failed to get latest checkpoint for ${this.config.chainName}`, error);
      return 0;
    }
  }

  override async checkForPastDeposits(options: {
    pastTimeInMinutes: number;
    latestBlock: number;
  }): Promise<void> {
    if (this.config.useEndpoint || !this.suiClient) {
      return;
    }

    try {
      const eventFilter: SuiEventFilter = {
        MoveModule: {
          package: this.config.l2PackageId,
          module: 'BitcoinDepositor',
        },
      };

      logger.debug(`checkForPastDeposits filter for ${this.config.chainName}:`, {
        package: this.config.l2PackageId,
        module: 'BitcoinDepositor',
      });

      // Query events in batches
      let cursor = null;
      let hasNextPage = true;
      let totalEvents = 0;

      while (hasNextPage) {
        const response: any = await this.suiClient.queryEvents({
          query: eventFilter,
          cursor,
          limit: 50,
          order: 'descending',
        });

        logger.debug(
          `checkForPastDeposits batch for ${this.config.chainName}: ${response.data.length} events`,
        );
        totalEvents += response.data.length;

        for (const eventData of response.data) {
          await this.handleSuiDepositEvent(eventData, true); // true = isPastEvent
        }

        hasNextPage = response.hasNextPage;
        cursor = response.nextCursor;
      }

      logger.debug(
        `checkForPastDeposits completed for ${this.config.chainName}: ${totalEvents} total events processed`,
      );

      logger.debug(
        `Checked past deposits for ${this.config.chainName}: ${options.pastTimeInMinutes} minutes`,
      );
    } catch (error: any) {
      logErrorContext(`Failed to check past deposits for ${this.config.chainName}`, error);
    }
  }

  override supportsPastDepositCheck(): boolean {
    return !!(this.config.l2Rpc && !this.config.useEndpoint);
  }

  /**
   * Override finalizeDeposit to:
   *  1) finalize on L1 (super call)
   *  2) parse Wormhole transferSequence from logs
   *  3) update deposit to AWAITING_WORMHOLE_VAA
   */
  override async finalizeDeposit(deposit: Deposit): Promise<TransactionReceipt | undefined> {
    if (!this.isDepositFinalizable(deposit)) return;

    const receipt = await this.submitFinalizationTx(deposit);

    if (receipt) {
      logger.info(`Processing Sui deposit finalization for ${deposit.id}...`);

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
        await updateToFinalizedDeposit(deposit, { hash: receipt.transactionHash }, 'transferSequence_not_found');
        const sentryErr = new Error(
          `transferSequence_not_found for deposit ${deposit.id} on ${this.config.chainName} — manual intervention required`,
        );
        Sentry.captureException(sentryErr, {
          extra: { depositId: deposit.id, chainName: this.config.chainName, txHash: receipt.transactionHash },
        });
        logger.error(
          `Could not parse transferSequence for deposit ${deposit.id} — finalizeTxHash stored, manual intervention required`,
        );
      }
    }

    return receipt;
  }

  /**
   * Processes SUI DepositInitialized Move events from the BitcoinDepositor contract.
   *
   * **Event Processing Strategy:**
   * This method uses the `parseDepositInitializedEvent` utility function for robust
   * binary data parsing rather than direct event casting. This approach is preferred because:
   *
   * - ✅ **Handles Binary Data Correctly**: SUI Move events contain vector<u8> fields that
   *   can be serialized as either `number[]` arrays or hex strings depending on the RPC endpoint
   * - ✅ **Type Safety**: Provides comprehensive validation and type conversion
   * - ✅ **Error Resilience**: Includes specific error handling for Bitcoin parsing failures
   * - ✅ **Address Conversion**: Properly converts binary address data to SUI hex format
   *
   * **Move Event Structure:**
   * ```move
   * public struct DepositInitialized has copy, drop {
   *     funding_tx: vector<u8>,      // Bitcoin transaction bytes
   *     deposit_reveal: vector<u8>,  // Reveal data (112 bytes)
   *     deposit_owner: vector<u8>,   // L2 deposit owner address
   *     sender: vector<u8>,          // L2 transaction sender address
   * }
   * ```
   *
   * **Processing Flow:**
   * 1. Parse binary event fields using utility function
   * 2. Create deposit object from parsed Bitcoin data
   * 3. Check for existing deposits to prevent duplicates
   * 4. Save to database and log successful processing
   *
   * @param event - SUI Move event containing DepositInitialized data
   * @param _isPastEvent - Whether this is a historical event (unused but kept for interface compatibility)
   */
  private async handleSuiDepositEvent(event: SuiEvent, _isPastEvent = false): Promise<void> {
    try {
      logger.debug(
        `handleSuiDepositEvent called for ${this.config.chainName}, event type: ${event.type}`,
      );

      // Use the utility function to parse the event data
      const parsedEvent = parseDepositInitializedEvent(event, this.config.chainName);

      if (!parsedEvent) {
        // Event parsing failed or event is not a DepositInitialized event
        logger.debug(`Event parsing returned null for ${this.config.chainName}`);
        return;
      }

      logger.info(`Successfully parsed SUI deposit event for ${this.config.chainName}`);

      // For SUI, we need to set the correct vault address since it's not included in the event
      // Update the reveal object with the correct vault address from the config
      const revealWithVault = {
        ...parsedEvent.reveal,
        vault: this.config.vaultAddress,
      };

      logger.info(`Setting vault address for SUI deposit: ${this.config.vaultAddress}`);

      // Create deposit using the parsed event data
      // Note: The 0x prefix handling is done in BaseChainHandler.initializeDeposit for SUI chains
      logger.debug('Creating deposit from parsed SUI event', {
        fundingTxVersion: parsedEvent.fundingTransaction.version,
        fundingOutputIndex: parsedEvent.reveal.fundingOutputIndex,
        depositOwner: parsedEvent.depositOwner,
        sender: parsedEvent.sender,
        chainName: this.config.chainName,
      });

      const deposit = createDeposit(
        parsedEvent.fundingTransaction,
        revealWithVault,
        parsedEvent.depositOwner,
        parsedEvent.sender,
        this.config.chainName,
      );

      logger.debug(`Created deposit object for SUI event:`, {
        depositId: deposit.id,
        depositOwner: parsedEvent.depositOwner,
        sender: parsedEvent.sender,
        fundingOutputIndex: parsedEvent.reveal.fundingOutputIndex,
        chainName: this.config.chainName,
        status: deposit.status,
        fundingTxHash: deposit.fundingTxHash,
        outputIndex: deposit.outputIndex,
      });

      // Check if deposit already exists to prevent duplicates
      const existingDeposit = await DepositStore.getById(deposit.id);
      if (existingDeposit) {
        logger.debug(
          `Deposit ${deposit.id} already exists for ${this.config.chainName}. Skipping creation.`,
        );
        return;
      }

      // Save deposit to database
      await DepositStore.create(deposit);

      logger.info(`SUI deposit successfully created and saved: ${deposit.id}`, {
        depositOwner: deposit.L1OutputEvent.l2DepositOwner,
        sender: deposit.L1OutputEvent.l2Sender,
        fundingOutputIndex: deposit.outputIndex,
        chainName: this.config.chainName,
        status: deposit.status,
        fundingTxHash: deposit.fundingTxHash,
      });
    } catch (error: any) {
      logErrorContext(`Error handling SUI deposit event for ${this.config.chainName}`, error);
    }
  }

  public async bridgeSuiDeposit(deposit: Deposit): Promise<void> {
    if (!this.suiClient || !this.keypair) {
      logger.warn(`Sui connection not initialized. Cannot bridge deposit ${deposit.id}.`);
      return;
    }

    if (deposit.status !== DepositStatus.AWAITING_WORMHOLE_VAA) return;

    try {
      if (!deposit.wormholeInfo?.transferSequence) {
        logger.warn(`No transfer sequence for deposit ${deposit.id}`);
        return;
      }

      logger.info(`Bridging deposit ${deposit.id} on Sui...`);
      logger.info(
        `Using sequence ${deposit.wormholeInfo.transferSequence} from L1 tx ${deposit.wormholeInfo.txHash}`,
      );

      // Fetch VAA using shared Wormhole API utility
      const vaaBytes = await fetchVAAFromAPI(
        deposit.wormholeInfo.transferSequence,
        this.config.network,
      );

      if (!vaaBytes) {
        logger.warn(
          `VAA not yet available for deposit ${deposit.id}, sequence ${deposit.wormholeInfo.transferSequence}`,
        );
        return;
      }

      logger.info(`VAA found for deposit ${deposit.id}. Posting VAA to Sui...`);

      // Convert base64 VAA to array format for Sui Move call
      const vaaArray = Array.from(Buffer.from(vaaBytes, 'base64')) as number[];

      // Validate VAA array before using it in the transaction
      if (vaaArray.length === 0) {
        logger.error(
          `VAA array is empty for deposit ${deposit.id}. Cannot proceed with transaction.`,
        );
        throw new Error(`Invalid VAA data: array is empty`);
      }

      logger.debug(`Prepared VAA for Sui transaction`, {
        depositId: deposit.id,
        vaaLength: vaaArray.length,
        transferSequence: deposit.wormholeInfo.transferSequence,
      });

      // Create Sui transaction
      const tx = new Transaction();

      try {
        // Call receiveWormholeMessages directly on the BitcoinDepositor contract
        tx.moveCall({
          target: `${this.config.l2PackageId}::BitcoinDepositor::receiveWormholeMessages`,
          arguments: [
            tx.object(this.config.receiverStateId),
            tx.object(this.config.gatewayStateId),
            tx.object(this.config.capabilitiesId),
            tx.object(this.config.treasuryId),
            tx.object(this.config.wormholeCoreId),
            tx.object(this.config.tokenBridgeId),
            tx.object(this.config.tokenStateId),
            tx.pure.vector('u8', vaaArray),
            tx.object('0x6'), // Clock object
          ],
          typeArguments: [this.config.wrappedTbtcType],
        });

        logger.debug(`Constructed Sui transaction for receiveWormholeMessages`, {
          depositId: deposit.id,
          packageId: this.config.l2PackageId,
          receiverStateId: this.config.receiverStateId,
          gatewayStateId: this.config.gatewayStateId,
          capabilitiesId: this.config.capabilitiesId,
          treasuryId: this.config.treasuryId,
          wormholeCoreId: this.config.wormholeCoreId,
          tokenBridgeId: this.config.tokenBridgeId,
          tokenStateId: this.config.tokenStateId,
          wrappedTbtcType: this.config.wrappedTbtcType,
        });

        // Sign and execute transaction
        const result = await this.suiClient.signAndExecuteTransaction({
          transaction: tx,
          signer: this.keypair,
          options: {
            showEffects: true,
            showEvents: true,
          },
        });

        // Validate transaction execution
        if (result.effects?.status?.status !== 'success') {
          const errorMessage = result.effects?.status?.error || 'Unknown transaction error';
          throw new Error(`Transaction failed: ${errorMessage}`);
        }

        if (!result.digest) {
          throw new Error('Transaction executed but no digest returned');
        }

        logger.info(`Successfully submitted VAA to BitcoinDepositor. TX: ${result.digest}`, {
          depositId: deposit.id,
          transactionDigest: result.digest,
          transferSequence: deposit.wormholeInfo.transferSequence,
          gasUsed: result.effects?.gasUsed || 'unknown',
        });

        // Log transaction events for debugging
        if (result.events && result.events.length > 0) {
          logger.debug(`Transaction events for deposit ${deposit.id}:`, {
            eventCount: result.events.length,
            events: result.events.map((event) => ({
              type: event.type,
              sender: event.sender,
            })),
          });
        }

        // Update deposit status to BRIDGED
        await updateToBridgedDeposit(deposit, result.digest, CHAIN_TYPE.SUI);

        logger.info(`Sui bridging completed successfully for deposit ${deposit.id}`);
      } catch (transactionError: any) {
        logger.error(`Failed to execute Sui transaction for deposit ${deposit.id}`, {
          error: transactionError.message,
          depositId: deposit.id,
          transferSequence: deposit.wormholeInfo.transferSequence,
          packageId: this.config.l2PackageId,
        });
        throw transactionError;
      }
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
   * Process all deposits that are in the AWAITING_WORMHOLE_VAA status.
   * This function will attempt to bridge the deposits using the Wormhole protocol.
   * Also surfaces any FINALIZED deposits with a transferSequence_not_found error
   * via Sentry so operators are alerted to investigate.
   */
  public async processWormholeBridging(): Promise<void> {
    if (this.config.chainType !== CHAIN_TYPE.SUI) return; // Only for Sui chains

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
      await this.bridgeSuiDeposit(deposit);
    }

    // Alert on FINALIZED deposits whose transferSequence was never parsed.
    // These cannot be auto-recovered; the Sentry alert prompts manual investigation.
    const RECOVERY_DELAY_MS = 5 * 60 * 1000;
    const now = Date.now();
    const finalizedDeposits = await DepositStore.getByStatus(
      DepositStatus.FINALIZED,
      this.config.chainName,
    );
    for (const deposit of finalizedDeposits) {
      if (deposit.error !== 'transferSequence_not_found') continue;
      if (!deposit.dates.finalizationAt) continue;
      if (now - deposit.dates.finalizationAt <= RECOVERY_DELAY_MS) continue;
      const msg = `Deposit ${deposit.id} is stuck in FINALIZED with transferSequence_not_found — manual intervention required`;
      logger.error(msg, { depositId: deposit.id, chainName: this.config.chainName });
      Sentry.captureException(new Error(msg), {
        extra: {
          depositId: deposit.id,
          chainName: this.config.chainName,
          finalizeTxHash: deposit.hashes?.eth?.finalizeTxHash,
          finalizationAt: deposit.dates.finalizationAt,
        },
      });
    }
  }

}
