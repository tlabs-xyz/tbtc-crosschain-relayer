import { ChainConfig, ChainType } from '../types/ChainConfig.type';
import { Deposit } from '../types/Deposit.type';
import { LogError, LogMessage, LogWarning } from '../utils/Logs';
import { BaseChainHandler } from './BaseChainHandler';
import { DepositStatus } from '../types/DepositStatus.enum';

// Import from Sui SDK using subpath exports
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SuiClient } = require('@mysten/sui/client');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { TransactionBlock } = require('@mysten/sui/transactions');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fromB64 } = require('@mysten/sui/utils');

// Transaction status constants
enum TxStatus {
  SUCCESS = 'success',
  FAILURE = 'failure',
  PENDING = 'pending',
}

// Pending VAA submission tracking interface
interface PendingVaaSubmission {
  depositId: string;
  vaaBytes: string; // Base64 encoded
  lastAttempt: number;
  attempts: number;
}

export class SuiChainHandler extends BaseChainHandler {
  // Define Sui specific properties
  private suiClient?: any; // Using any type to bypass TypeScript errors
  private suiKeypair?: any;
  private suiAddress?: string;

  // Package IDs and object IDs needed for transactions
  private bitcoinDepositorPackageId?: string;
  private bitcoinDepositorModuleName: string = 'BitcoinDepositor';
  private receiverStateId?: string;
  private gatewayStateId?: string;
  private gatewayCapabilitiesId?: string;
  private treasuryId?: string;
  private wormholeStateId?: string;
  private tokenBridgeStateId?: string;
  private tbtcTokenStateId?: string;

  // Track pending VAA submissions - in a real production system, this would be persisted
  private pendingVaaSubmissions: PendingVaaSubmission[] = [];
  private readonly MAX_SUBMISSION_ATTEMPTS = 5;
  private readonly SUBMISSION_RETRY_DELAY_MS = 30000; // 30 seconds

  constructor(config: ChainConfig) {
    super(config);
    LogMessage(`Constructing SuiChainHandler for ${this.config.chainName}`);
    if (config.chainType !== ChainType.SUI) {
      throw new Error(
        `Incorrect chain type ${config.chainType} provided to SuiChainHandler.`
      );
    }
  }

  protected async initializeL2(): Promise<void> {
    LogMessage(`Initializing Sui L2 components for ${this.config.chainName}`);

    if (!this.config.l2Rpc) {
      LogWarning(
        `Sui L2 RPC not configured for ${this.config.chainName}. L2 features disabled.`
      );
      return;
    }

    try {
      // Initialize Sui client
      const rpcUrl = this.config.l2Rpc;
      this.suiClient = new SuiClient({ url: rpcUrl });

      // Initialize Sui keypair if privateKey is provided
      if (
        this.config.l2PrivateKey &&
        this.config.l2PrivateKey !== 'YOUR_SUI_PRIVATE_KEY_BASE64_ENCODED'
      ) {
        try {
          // Expect private key to be in base64 format
          const privateKeyBytes = fromB64(this.config.l2PrivateKey);
          this.suiKeypair = Ed25519Keypair.fromSecretKey(privateKeyBytes);
          this.suiAddress = this.suiKeypair.getPublicKey().toSuiAddress();
          LogMessage(
            `Sui L2 wallet initialized with address: ${this.suiAddress}`
          );
        } catch (error: any) {
          LogWarning(
            `Invalid Sui L2 private key format for ${this.config.chainName}. Cannot sign transactions.`
          );
        }
      } else {
        LogWarning(
          `No valid Sui L2 private key provided for ${this.config.chainName}. Cannot sign transactions.`
        );
      }

      // Store package and object IDs from config
      if (
        this.config.l2ContractAddress &&
        !this.config.l2ContractAddress.includes('YOUR_SUI_') &&
        this.config.l2ContractAddress !==
          '0xYOUR_SUI_BITCOINDEPOSITOR_PACKAGE_ID'
      ) {
        this.bitcoinDepositorPackageId = this.config.l2ContractAddress;

        // These should come from config in a production system
        this.receiverStateId = this.config.receiverStateId;
        this.gatewayStateId = this.config.gatewayStateId;
        this.gatewayCapabilitiesId = this.config.gatewayCapabilitiesId;
        this.treasuryId = this.config.treasuryId;
        this.wormholeStateId = this.config.wormholeStateId;
        this.tokenBridgeStateId = this.config.tokenBridgeStateId;
        this.tbtcTokenStateId = this.config.tbtcTokenStateId;

        // Log missing required object IDs
        if (
          !this.receiverStateId ||
          this.receiverStateId.includes('YOUR_') ||
          this.receiverStateId === '0xYOUR_RECEIVER_STATE_OBJECT_ID'
        ) {
          LogWarning(
            `Missing or invalid receiverStateId for ${this.config.chainName}`
          );
        }
        if (
          !this.gatewayStateId ||
          this.gatewayStateId.includes('YOUR_') ||
          this.gatewayStateId === '0xYOUR_GATEWAY_STATE_OBJECT_ID'
        ) {
          LogWarning(
            `Missing or invalid gatewayStateId for ${this.config.chainName}`
          );
        }
        if (
          !this.gatewayCapabilitiesId ||
          this.gatewayCapabilitiesId.includes('YOUR_') ||
          this.gatewayCapabilitiesId === '0xYOUR_GATEWAY_CAPABILITIES_OBJECT_ID'
        ) {
          LogWarning(
            `Missing or invalid gatewayCapabilitiesId for ${this.config.chainName}`
          );
        }
        if (
          !this.wormholeStateId ||
          this.wormholeStateId.includes('YOUR_') ||
          this.wormholeStateId === '0xYOUR_WORMHOLE_STATE_OBJECT_ID'
        ) {
          LogWarning(
            `Missing or invalid wormholeStateId for ${this.config.chainName}`
          );
        }
        if (
          !this.tokenBridgeStateId ||
          this.tokenBridgeStateId.includes('YOUR_') ||
          this.tokenBridgeStateId === '0xYOUR_TOKEN_BRIDGE_STATE_OBJECT_ID'
        ) {
          LogWarning(
            `Missing or invalid tokenBridgeStateId for ${this.config.chainName}`
          );
        }
        if (
          !this.tbtcTokenStateId ||
          this.tbtcTokenStateId.includes('YOUR_') ||
          this.tbtcTokenStateId === '0xYOUR_TBTC_TOKEN_STATE_OBJECT_ID'
        ) {
          LogWarning(
            `Missing or invalid tbtcTokenStateId for ${this.config.chainName}`
          );
        }
        if (
          !this.treasuryId ||
          this.treasuryId.includes('YOUR_') ||
          this.treasuryId === '0xYOUR_TREASURY_OBJECT_ID'
        ) {
          LogWarning(
            `Missing or invalid treasuryId for ${this.config.chainName}`
          );
        }
      } else {
        LogWarning(
          `No BitcoinDepositor package ID provided for ${this.config.chainName}.`
        );
      }

      LogMessage(`Sui L2 client initialized for ${this.config.chainName}`);
    } catch (error: any) {
      LogError(
        `Failed to initialize Sui L2 components for ${this.config.chainName}: ${error.message}`,
        error
      );
      throw error;
    }
  }

  protected async setupL2Listeners(): Promise<void> {
    if (this.config.useEndpoint) {
      LogMessage(
        `Sui L2 Listeners skipped for ${this.config.chainName} (using Endpoint).`
      );
      return;
    }

    if (!this.suiClient || !this.bitcoinDepositorPackageId) {
      LogWarning(
        `Cannot setup Sui L2 listeners for ${this.config.chainName}. Missing client or package ID.`
      );
      return;
    }

    try {
      LogMessage(
        `Setting up Sui L2 event subscription for ${this.config.chainName}`
      );

      // Create filter for DepositInitialized events from BitcoinDepositor
      const depositInitializedFilter: any = {
        MoveEventType: `${this.bitcoinDepositorPackageId}::${this.bitcoinDepositorModuleName}::DepositInitialized`,
      };

      // Subscribe to DepositInitialized events
      this.suiClient.subscribeEvent({
        filter: depositInitializedFilter,
        onMessage: this.handleDepositInitializedEvent.bind(this),
      });

      LogMessage(
        `Sui L2 DepositInitialized event subscription setup for ${this.config.chainName}`
      );

      // Set up a periodic check for pending VAA submissions
      // In a production system, this would be more sophisticated
      setInterval(() => this.processPendingVaaSubmissions(), 60000); // Check every minute
    } catch (error: any) {
      LogError(
        `Failed to setup Sui L2 listeners for ${this.config.chainName}: ${error.message}`,
        error
      );
    }
  }

  private async handleDepositInitializedEvent(event: any): Promise<void> {
    try {
      LogMessage(
        `Received DepositInitialized event on ${this.config.chainName}`
      );

      // Extract event data
      if (!event.parsedJson) {
        throw new Error('Event has no parsedJson data');
      }

      const eventData = event.parsedJson as {
        funding_tx: string;
        deposit_reveal: string;
        deposit_owner: string;
        sender: string;
      };

      LogMessage(
        `DepositInitialized event: 
        funding_tx: ${eventData.funding_tx?.substring(0, 32)}...
        deposit_owner: ${eventData.deposit_owner}
        sender: ${eventData.sender}`
      );

      // Create a unique ID for this deposit based on the event fields
      // In a real implementation, we'd compute this properly using the same algorithm as the L1 contract
      // For now, use a simplified approach
      const eventId = event.id.txDigest;

      // Create a simplified Deposit object with just the fields needed for initializeDeposit
      const depositData = {
        id: eventId, // We'll use the Sui event's transaction digest as the ID
        status: DepositStatus.QUEUED,
        dates: {
          createdAt: Date.now(),
          initializationAt: null,
          finalizationAt: null,
          lastActivityAt: Date.now(),
        },
        L1OutputEvent: {
          fundingTx: {
            version: `0x${Buffer.from(eventData.funding_tx, 'base64').toString('hex').substring(0, 8)}`,
            inputVector: `0x${Buffer.from(eventData.funding_tx, 'base64').toString('hex').substring(8, 16)}`,
            outputVector: `0x${Buffer.from(eventData.funding_tx, 'base64').toString('hex').substring(16, 24)}`,
            locktime: `0x${Buffer.from(eventData.funding_tx, 'base64').toString('hex').substring(24, 32)}`,
          },
          reveal: [
            0, // fundingOutputIndex,
            `0x${Buffer.from(eventData.deposit_reveal, 'base64').toString('hex').substring(0, 16)}`, // blindingFactor
            `0x${Buffer.from(eventData.deposit_reveal, 'base64').toString('hex').substring(16, 36)}`, // walletPubKeyHash
            `0x${Buffer.from(eventData.deposit_reveal, 'base64').toString('hex').substring(36, 56)}`, // refundPubKeyHash
            `0x${Buffer.from(eventData.deposit_reveal, 'base64').toString('hex').substring(56, 64)}`, // refundLocktime
          ],
          l2DepositOwner: eventData.deposit_owner,
          l2Sender: eventData.sender,
        },
      };

      // Process the deposit - this will eventually call initializeDeposit on the L1 contract
      const deposit = {
        ...depositData,
        chain: this.config.chainName,
      } as unknown as Deposit;
      await this.initializeDeposit(deposit);
    } catch (error: any) {
      LogError(
        `Error handling DepositInitialized event on ${this.config.chainName}: ${error.message}`,
        error
      );
    }
  }

  /**
   * Submits a VAA to the Sui BitcoinDepositor contract
   * This is the main function for completing the cross-chain flow
   */
  async submitVaaToSui(depositId: string, vaaBytes: string): Promise<boolean> {
    if (!this.suiClient || !this.suiKeypair) {
      LogError(
        `Cannot submit VAA to Sui: Missing client or keypair`,
        new Error('Missing client or keypair')
      );
      return false;
    }

    if (
      !this.bitcoinDepositorPackageId ||
      !this.receiverStateId ||
      !this.gatewayStateId ||
      !this.gatewayCapabilitiesId ||
      !this.treasuryId ||
      !this.wormholeStateId ||
      !this.tokenBridgeStateId ||
      !this.tbtcTokenStateId
    ) {
      LogError(
        `Cannot submit VAA to Sui: Missing required object IDs`,
        new Error('Missing required object IDs')
      );
      return false;
    }

    try {
      LogMessage(`Submitting VAA to Sui for deposit ID: ${depositId}`);

      // Create a Transaction Block
      const tx = new TransactionBlock();

      // Call BitcoinDepositor::receiveWormholeMessages function
      // Assuming the VAA is in base64 format and needs to be converted to bytes
      const vaaArg = tx.pure.string(vaaBytes);

      // Add the moveCall
      tx.moveCall({
        target: `${this.bitcoinDepositorPackageId}::${this.bitcoinDepositorModuleName}::receiveWormholeMessages`,
        arguments: [
          tx.object(this.receiverStateId), // receiver_state
          tx.object(this.gatewayStateId), // gateway_state
          tx.object(this.gatewayCapabilitiesId), // capabilities
          tx.object(this.treasuryId), // treasury
          tx.object(this.wormholeStateId), // wormhole_state
          tx.object(this.tokenBridgeStateId), // token_bridge_state
          tx.object(this.tbtcTokenStateId), // token_state
          vaaArg, // vaa_bytes
          tx.object('0x6'), // clock (Sui system clock object)
        ],
        typeArguments: [
          /* CoinType parameter - use the appropriate wrapped token type */
          '0x[WRAPPED_TOKEN_TYPE]', // This should be the actual coin type of the wrapped token
        ],
      });

      // Sign the transaction block
      const signedTx = await this.suiClient.signAndExecuteTransactionBlock({
        transactionBlock: tx,
        signer: this.suiKeypair,
        options: {
          showEffects: true,
          showEvents: true,
        },
      });

      LogMessage(
        `VAA submission transaction for ${depositId} executed: ${signedTx.digest}`
      );

      // Check transaction status
      const status = signedTx.effects?.status?.status;

      if (status === TxStatus.SUCCESS) {
        LogMessage(`VAA submission for deposit ${depositId} successful`);
        return true;
      } else {
        const error = signedTx.effects?.status?.error;
        LogError(
          `VAA submission for deposit ${depositId} failed: ${error}`,
          new Error(error || 'Unknown error')
        );
        return false;
      }
    } catch (error: any) {
      LogError(
        `Error submitting VAA to Sui for ${depositId}: ${error.message}`,
        error
      );

      // Add to pending submissions for retry
      this.addPendingVaaSubmission(depositId, vaaBytes);

      return false;
    }
  }

  /**
   * Add a VAA submission to the pending list for retry
   */
  private addPendingVaaSubmission(depositId: string, vaaBytes: string): void {
    // Check if already in the pending list
    const existing = this.pendingVaaSubmissions.find(
      (p) => p.depositId === depositId
    );
    if (existing) {
      // Update existing record
      existing.lastAttempt = Date.now();
      existing.attempts += 1;
      LogMessage(
        `Updated pending VAA submission for ${depositId}: attempt ${existing.attempts}`
      );
    } else {
      // Add new pending submission
      this.pendingVaaSubmissions.push({
        depositId,
        vaaBytes,
        lastAttempt: Date.now(),
        attempts: 1,
      });
      LogMessage(`Added new pending VAA submission for ${depositId}`);
    }
  }

  /**
   * Process pending VAA submissions - retry with backoff
   */
  private async processPendingVaaSubmissions(): Promise<void> {
    if (this.pendingVaaSubmissions.length === 0) {
      return; // Nothing to do
    }

    LogMessage(
      `Processing ${this.pendingVaaSubmissions.length} pending VAA submissions`
    );

    const now = Date.now();
    const submissionsToProcess = this.pendingVaaSubmissions.filter(
      (p) =>
        now - p.lastAttempt > this.SUBMISSION_RETRY_DELAY_MS &&
        p.attempts < this.MAX_SUBMISSION_ATTEMPTS
    );

    if (submissionsToProcess.length === 0) {
      LogMessage('No pending VAA submissions ready for retry yet');
      return;
    }

    LogMessage(`Retrying ${submissionsToProcess.length} VAA submissions`);

    // Process each pending submission
    for (const submission of submissionsToProcess) {
      LogMessage(
        `Retrying VAA submission for ${submission.depositId} (attempt ${submission.attempts + 1})`
      );

      const success = await this.submitVaaToSui(
        submission.depositId,
        submission.vaaBytes
      );

      if (success) {
        // Remove from pending list
        this.pendingVaaSubmissions = this.pendingVaaSubmissions.filter(
          (p) => p.depositId !== submission.depositId
        );
        LogMessage(
          `Successfully processed VAA submission for ${submission.depositId} on retry`
        );
      }
    }

    // Clean up submissions that have exceeded max attempts
    const expired = this.pendingVaaSubmissions.filter(
      (p) => p.attempts >= this.MAX_SUBMISSION_ATTEMPTS
    );
    if (expired.length > 0) {
      LogWarning(
        `${expired.length} VAA submissions exceeded max retry attempts and will be dropped`
      );
      this.pendingVaaSubmissions = this.pendingVaaSubmissions.filter(
        (p) => p.attempts < this.MAX_SUBMISSION_ATTEMPTS
      );

      // In a production system, these would be logged to a database or alerting system
      for (const submission of expired) {
        LogError(
          `VAA submission for ${submission.depositId} failed after ${submission.attempts} attempts`,
          new Error('Max retry attempts exceeded')
        );
      }
    }
  }

  async getLatestBlock(): Promise<number> {
    if (this.config.useEndpoint) return 0;

    try {
      if (!this.suiClient) {
        LogWarning(`Cannot get latest Sui block: Missing client`);
        return 0;
      }

      // Get the latest checkpoint sequence number
      const latestCheckpoint =
        await this.suiClient.getLatestCheckpointSequenceNumber();
      return Number(latestCheckpoint);
    } catch (error: any) {
      LogError(`Error getting latest Sui block: ${error.message}`, error);
      return 0;
    }
  }

  async checkForPastDeposits(options: {
    pastTimeInMinutes: number;
    latestBlock: number;
  }): Promise<void> {
    if (this.config.useEndpoint) return;

    if (!this.suiClient || !this.bitcoinDepositorPackageId) {
      LogWarning(
        `Cannot check for past Sui deposits: Missing client or package ID`
      );
      return;
    }

    try {
      const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds
      const pastTime = currentTime - options.pastTimeInMinutes * 60; // Past time in seconds

      LogMessage(
        `Checking for past Sui DepositInitialized events (past ${options.pastTimeInMinutes} minutes)`
      );

      // Query for past events using the MoveEventType filter
      const pastEvents = await this.suiClient.queryEvents({
        query: {
          MoveEventType: `${this.bitcoinDepositorPackageId}::${this.bitcoinDepositorModuleName}::DepositInitialized`,
        },
        order: 'descending',
        limit: 50, // Limit the number of events to process at once
      });

      if (pastEvents.data.length === 0) {
        LogMessage('No past DepositInitialized events found');
        return;
      }

      LogMessage(
        `Found ${pastEvents.data.length} past DepositInitialized events`
      );

      // Process each event
      for (const event of pastEvents.data) {
        // Skip events that are too recent (may still be processing)
        const eventTimestamp = Number(event.timestampMs) / 1000; // Convert to seconds
        if (eventTimestamp > pastTime) {
          continue;
        }

        // Process the event
        await this.handleDepositInitializedEvent(event);
      }
    } catch (error: any) {
      LogError(`Error checking for past Sui deposits: ${error.message}`, error);
    }
  }

  supportsPastDepositCheck(): boolean {
    const supports = !!(
      this.config.l2Rpc &&
      this.bitcoinDepositorPackageId &&
      !this.config.useEndpoint
    );
    return supports;
  }
}
