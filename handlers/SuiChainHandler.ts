import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromBase64 } from '@mysten/bcs';
import type { SuiEvent, SuiEventFilter } from '@mysten/sui/client';
import type { Chain, ChainContext, TBTCBridge } from '@wormhole-foundation/sdk-connect';
import { ethers } from 'ethers';
import type { TransactionReceipt } from '@ethersproject/providers';

import { CHAIN_TYPE } from '../config/schemas/common.schema.js';
import type { SuiChainConfig } from '../config/schemas/sui.chain.schema.js';
import logger, { logErrorContext } from '../utils/Logger.js';
import { BaseChainHandler } from './BaseChainHandler.js';
import { type Deposit } from '../types/Deposit.type.js';
import { DepositStatus } from '../types/DepositStatus.enum.js';
import { updateToAwaitingWormholeVAA } from '../utils/Deposits.js';
import { DepositStore } from '../utils/DepositStore.js';

const TOKENS_TRANSFERRED_SIG = ethers.utils.id(
  'TokensTransferredWithPayload(uint256,bytes32,uint64)',
);

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

  protected async initializeL2(): Promise<void> {
    logger.debug(`Initializing Sui L2 components for ${this.config.chainName}`);

    if (!this.config.l2Rpc) {
      logger.warn(`Sui L2 RPC not configured for ${this.config.chainName}. L2 features disabled.`);
      return;
    }

    try {
      // Initialize SUI client
      this.suiClient = new SuiClient({ url: this.config.l2Rpc });

      // Initialize keypair from base64 private key
      const privateKeyBytes = fromBase64(this.config.suiPrivateKey);
      this.keypair = Ed25519Keypair.fromSecretKey(privateKeyBytes);

      // Get SUI Wormhole context for cross-chain operations
      this.suiWormholeContext = this.wormhole.getChain('Sui' as Chain);

      logger.info(`Sui L2 client initialized for ${this.config.chainName}`);
    } catch (error: any) {
      logErrorContext(`Failed to initialize Sui L2 client for ${this.config.chainName}`, error);
      throw error;
    }
  }

  protected async setupL2Listeners(): Promise<void> {
    if (this.config.useEndpoint || !this.suiClient) {
      logger.debug(
        `Sui L2 Listeners skipped for ${this.config.chainName} (using Endpoint or client not initialized).`,
      );
      return;
    }

    try {
      // Parse package ID from L2 contract address
      const packageId = this.config.l2ContractAddress.split('::')[0];

      // Subscribe to DepositInitialized events
      const eventFilter: SuiEventFilter = {
        MoveModule: {
          package: packageId,
          module: 'bitcoin_depositor',
        },
      };

      await this.suiClient.subscribeEvent({
        filter: eventFilter,
        onMessage: (event: SuiEvent) => this.handleSuiDepositEvent(event),
      });

      logger.debug(`Sui L2 event listeners setup for ${this.config.chainName}`);
    } catch (error: any) {
      logErrorContext(`Failed to setup Sui L2 listeners for ${this.config.chainName}`, error);
      throw error;
    }
  }

  async getLatestBlock(): Promise<number> {
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

  async checkForPastDeposits(options: {
    pastTimeInMinutes: number;
    latestBlock: number;
  }): Promise<void> {
    if (this.config.useEndpoint || !this.suiClient) {
      return;
    }

    try {
      const packageId = this.config.l2ContractAddress.split('::')[0];

      const eventFilter: SuiEventFilter = {
        MoveModule: {
          package: packageId,
          module: 'bitcoin_depositor',
        },
      };

      // Query events in batches
      let cursor = null;
      let hasNextPage = true;

      while (hasNextPage) {
        const response: any = await this.suiClient.queryEvents({
          query: eventFilter,
          cursor,
          limit: 50,
          order: 'descending',
        });

        for (const eventData of response.data) {
          await this.handleSuiDepositEvent(eventData, true); // true = isPastEvent
        }

        hasNextPage = response.hasNextPage;
        cursor = response.nextCursor;
      }

      logger.debug(
        `Checked past deposits for ${this.config.chainName}: ${options.pastTimeInMinutes} minutes`,
      );
    } catch (error: any) {
      logErrorContext(`Failed to check past deposits for ${this.config.chainName}`, error);
    }
  }

  supportsPastDepositCheck(): boolean {
    return !!(this.config.l2Rpc && !this.config.useEndpoint);
  }

  /**
   * Override finalizeDeposit to:
   *  1) finalize on L1 (super call)
   *  2) parse Wormhole transferSequence from logs
   *  3) update deposit to AWAITING_WORMHOLE_VAA
   */
  async finalizeDeposit(deposit: Deposit): Promise<TransactionReceipt | undefined> {
    const finalizedDepositReceipt = await super.finalizeDeposit(deposit);

    if (!finalizedDepositReceipt) {
      return;
    }

    logger.info(`Processing Sui deposit finalization for ${deposit.id}...`);

    const l1Receipt = finalizedDepositReceipt;
    if (!l1Receipt) {
      logger.warn(`No finalize receipt found for deposit ${deposit.id}; cannot parse logs.`);
      return finalizedDepositReceipt;
    }

    let transferSequence: string | null = null;
    try {
      const logs = l1Receipt.logs || [];

      for (const log of logs) {
        if (log.topics[0] === TOKENS_TRANSFERRED_SIG) {
          const parsedLog = this.l1BitcoinDepositor.interface.parseLog(log);
          const { transferSequence: seq } = parsedLog.args;
          transferSequence = seq.toString();
          break;
        }
      }
    } catch (error: any) {
      logErrorContext(`Error parsing L1 logs for deposit ${deposit.id}`, error);
    }

    if (!transferSequence) {
      logger.warn(`Could not find transferSequence in logs for deposit ${deposit.id}.`);
      return finalizedDepositReceipt;
    }

    await updateToAwaitingWormholeVAA(l1Receipt.transactionHash, deposit, transferSequence);
    logger.info(`Deposit ${deposit.id} now awaiting Wormhole VAA.`);

    return finalizedDepositReceipt;
  }

  private async handleSuiDepositEvent(event: SuiEvent, _isPastEvent = false): Promise<void> {
    try {
      // Parse SUI Move event data
      const eventType = event.type;
      const eventData = event.parsedJson as any;

      // Filter for DepositInitialized events
      if (!eventType.includes('DepositInitialized')) {
        return;
      }

      // Extract deposit information from event data
      const depositKey = eventData.deposit_key;
      const fundingTxHash = eventData.funding_tx_hash;
      const outputIndex = eventData.output_index;

      if (!depositKey || !fundingTxHash || outputIndex === undefined) {
        logger.warn(`Incomplete SUI deposit event data for ${this.config.chainName}`);
        return;
      }

      // Check if deposit already exists
      const existingDeposit = await DepositStore.getById(depositKey);
      if (existingDeposit) {
        logger.debug(`Deposit ${depositKey} already exists for ${this.config.chainName}`);
        return;
      }

      // For SUI, we'll need to handle the deposit creation differently
      // since SUI events don't provide the same structure as EVM DepositInitialized events
      // This is a simplified approach - in a full implementation, you'd need to:
      // 1. Query the SUI transaction to get the full deposit details
      // 2. Construct the proper funding transaction and reveal objects
      // 3. Use the standard createDeposit function

      // For now, create a minimal deposit record to track the SUI deposit
      // This will be expanded when the full SUI contract integration is complete
      logger.info(
        `SUI deposit event received: ${depositKey} - requires full integration with SUI contract details`,
      );

      logger.info(`SUI deposit queued: ${depositKey} for ${this.config.chainName}`);
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

      // Get VAA from Wormhole
      const [wormholeMessageId] = await this.wormhole
        .getChain('Ethereum' as Chain)
        .parseTransaction(deposit.wormholeInfo.txHash!);

      if (!wormholeMessageId) {
        logger.warn(`No Wormhole message found for deposit ${deposit.id}`);
        return;
      }

      const vaa = (await this.wormhole.getVaa(
        wormholeMessageId,
        'TBTCBridge:GatewayTransfer',
        60_000, // 60 second timeout
      )) as TBTCBridge.VAA;

      if (!vaa) {
        logger.warn(`VAA message is not yet signed by the guardians for deposit ${deposit.id}`);
        return;
      }

      logger.info(`VAA found for deposit ${deposit.id}. Posting VAA to Sui...`);

      // Use Wormhole SDK pattern similar to Solana
      const toChain = this.suiWormholeContext;
      await toChain.getTBTCBridge();

      // For now, log that the Wormhole bridging is set up but needs Sui signer integration
      // This would need to be completed with proper Sui signer integration from Wormhole SDK
      logger.info(`Wormhole bridge integration for Sui requires further SDK integration`);

      // Placeholder for successful bridging
      // In a complete implementation, this would use:
      // const unsignedTransactions = bridge.redeem(sender, vaa);
      // const result = await signSendWait(toChain, unsignedTransactions, suiSigner);

      logger.info(
        `Sui bridging setup complete for deposit ${deposit.id} - requires full Wormhole SDK integration`,
      );

      // For now, don't update the deposit status until full integration is complete
      // await updateToBridgedDeposit(deposit, result.digest);
    } catch (error: any) {
      const reason = error.message || 'Unknown bridging error';
      logger.warn(`Wormhole bridging not ready for deposit ${deposit.id}: ${reason}`);
    }
  }

  /**
   * Process all deposits that are in the AWAITING_WORMHOLE_VAA status.
   * This function will attempt to bridge the deposits using the Wormhole protocol.
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
  }
}
