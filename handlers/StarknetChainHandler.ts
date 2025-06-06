import type { StarknetChainConfig } from '../config/schemas/starknet.chain.schema.js';
import { StarknetChainConfigSchema } from '../config/schemas/starknet.chain.schema.js';
import logger, { logErrorContext } from '../utils/Logger.js';
import { BaseChainHandler } from './BaseChainHandler.js';

// Corrected ethers import
import * as ethers from 'ethers';
import type { PayableOverrides, BigNumberish, BytesLike } from 'ethers';

import { NonceManager } from '@ethersproject/experimental';
import { StarkNetBitcoinDepositorABI } from '../interfaces/StarkNetBitcoinDepositor.js';
import type { StarkNetBitcoinDepositor } from '../interfaces/IStarkNetBitcoinDepositor.js';

// Corrected StarkNet imports: separate types and values
import type { Abi } from 'starknet'; // Keep Abi as type-only
// RpcProvider, Account are classes, so they are values.
import { RpcProvider, Account, hash, events as starknetEvents, CallData, num } from 'starknet';
import type { RPC } from 'starknet'; // Changed Rpc to RPC

import { DepositStore } from '../utils/DepositStore.js';
import { DepositStatus } from '../types/DepositStatus.enum.js';
import {
  validateStarkNetAddress,
  formatStarkNetAddressForContract,
} from '../utils/starknetAddress.js';
import type { Deposit } from '../types/Deposit.type.js';
import type { Reveal } from '../types/Reveal.type.js';
import { getFundingTxHash } from '../utils/GetTransactionHash.js';
import {
  getDepositId,
  updateToInitializedDeposit,
  updateToFinalizedDeposit,
} from '../utils/Deposits.js';
import { logDepositError, logStatusChange } from '../utils/AuditLog.js';
import type { FundingTransaction } from '../types/FundingTransaction.type.js';
import { toSerializableError } from '../types/Error.types.js';

const STARKNET_AVG_BLOCK_TIME_SECONDS = 15; // Placeholder average block time
const EXPECTED_L2_DEPOSIT_EVENT_NAME = 'TBTCDepositFinalizedOnL2'; // Placeholder L2 event name to track

/**
 * Interface for the raw event structure returned by StarkNet RPC provider.getEvents(),
 * aligning with RPC spec (EMITTED_EVENT) and observed linter behavior for transaction_hash.
 * RPC Spec for EMITTED_EVENT includes block_hash, block_number, and transaction_hash.
 */
interface StarkNetRawEvent {
  from_address: string; // FELT
  keys: string[]; // list[FELT]
  data: string[]; // list[FELT]
  block_hash: string; // BLOCK_HASH (FELT)
  block_number: number; // BLOCK_NUMBER
  transaction_hash: bigint; // TXN_HASH (FELT), but StarkNet.js v6.0.0 seems to provide it as bigint
}

// Helper interface for errors with potential additional details
interface ErrorWithDetails extends Error {
  response?: {
    data?: unknown;
  };
  code?: unknown;
}

// --- BEGIN DEBUG LOGS FOR HANDLER ---
try {
  console.log('STARKNET_HANDLER_DEBUG: typeof ethers.Contract in handler:', typeof ethers.Contract);
  if (ethers.Contract) {
    console.log(
      'STARKNET_HANDLER_DEBUG: ethers.Contract.toString() in handler:',
      ethers.Contract.toString().substring(0, 500),
    );
    // Note: jest.requireActual might not be available or work as expected directly in source files
    // outside of a test environment. This log might be problematic or misleading here.
    // We'll keep it for now but be aware of its potential limitations.
    // const actualEthersContract = jest.requireActual('ethers').Contract;
    // console.log(
    //   'STARKNET_HANDLER_DEBUG: ethers.Contract === actualEthers.Contract:',
    //   ethers.Contract === actualEthersContract,
    // );
  }
} catch (e: unknown) {
  console.error('STARKNET_HANDLER_DEBUG: Error during logging:', (e as Error).message);
}
// --- END DEBUG LOGS FOR HANDLER ---

/**
 * StarkNet Cross-chain Handler Implementation
 *
 * This handler manages tBTC deposits and bridges between Ethereum L1 and StarkNet L2.
 * It supports:
 * - L1 deposit initialization and finalization via StarkGate bridge contracts
 * - L2 event monitoring and processing via StarkNet RPC
 * - Cross-chain state synchronization and audit logging
 *
 * Key Components:
 * - L1 StarkGate integration for deposit lifecycle management
 * - L2 StarkNet provider for event monitoring and transaction verification
 * - Event-driven architecture for real-time and historical deposit tracking
 *
 * Security Features:
 * - StarkNet address validation and formatting
 * - Transaction receipt verification for both L1 and L2
 * - Comprehensive error handling and audit logging
 *
 * @extends BaseChainHandler<StarknetChainConfig>
 */
export class StarknetChainHandler extends BaseChainHandler<StarknetChainConfig> {
  // --- L1 StarkGate Contract Instances ---
  /** L1 StarkGate contract instance for sending transactions (uses L1 signer with nonce manager) */
  protected l1DepositorContract: StarkNetBitcoinDepositor | undefined;
  /** L1 StarkGate contract instance for read-only operations and event listening (uses L1 provider) */
  protected l1DepositorContractProvider: StarkNetBitcoinDepositor | undefined;

  // --- L2 StarkNet Provider and Account ---
  /** StarkNet L2 RPC provider for read-only operations and querying */
  protected starknetL2Provider: RpcProvider | undefined;
  /** StarkNet L2 account for sending transactions */
  protected starknetL2Account: Account | undefined;

  private starknetProvider: RpcProvider;
  private l2EventsContractAbi?: Abi; // Store the ABI for L2 event parsing

  constructor(config: StarknetChainConfig) {
    super(config);
    try {
      StarknetChainConfigSchema.parse(this.config);
      logger.info(`StarknetChainHandler constructed and validated for ${this.config.chainName}`);
      if (this.config.l2Rpc && !this.config.l2EventsContractAbi) {
        logger.warn(
          `StarkNet L2 RPC is configured for ${this.config.chainName}, but l2EventsContractAbi is missing. L2 event processing will be disabled.`,
        );
      }
      if (this.config.l2Rpc && !this.config.l2ContractAddress) {
        logger.warn(
          `StarkNet L2 RPC is configured for ${this.config.chainName}, but l2ContractAddress is missing. L2 event processing will be disabled.`,
        );
      }
    } catch (error: unknown) {
      const serializableError = toSerializableError(error);
      logger.error(
        `Invalid StarkNet configuration for ${this.config.chainName}: ${serializableError.message}`,
      );
      throw new Error(
        `Invalid StarkNet configuration for ${this.config.chainName}. Please check logs for details.`,
      );
    }
    this.starknetProvider = new RpcProvider({ nodeUrl: this.config.l2Rpc });
    if (this.config.l2EventsContractAbi) {
      this.l2EventsContractAbi = this.config.l2EventsContractAbi as Abi;
    }
    logger.debug(`StarknetChainHandler constructor setup complete for ${this.config.chainName}`);
  }

  async initialize(): Promise<void> {
    await super.initialize();

    logger.info(`StarknetChainHandler: Post super.initialize() for ${this.config.chainName}.`);

    if (!this.l1Signer && this.config.starknetPrivateKey && this.l1Provider) {
      try {
        logger.info(
          `StarknetChainHandler: Initializing L1 signer using starknetPrivateKey for ${this.config.chainName}.`,
        );
        this.l1Signer = new ethers.Wallet(this.config.starknetPrivateKey, this.l1Provider);
        this.nonceManagerL1 = new NonceManager(this.l1Signer);
        logger.info(
          `StarknetChainHandler: L1 signer and NonceManager initialized successfully for ${this.config.chainName} using starknetPrivateKey.`,
        );
      } catch (error: unknown) {
        logErrorContext(
          `StarknetChainHandler: Failed to initialize L1 signer/NonceManager using starknetPrivateKey for ${this.config.chainName}: ${toSerializableError(error).message}`,
          error,
        );
      }
    } else if (!this.l1Signer) {
      logger.warn(
        `StarknetChainHandler: L1 Signer could not be initialized for ${this.config.chainName} (starknetPrivateKey or l1Provider missing/unavailable after super.initialize). L1 txs will be disabled.`,
      );
    }

    if (this.config.l1ContractAddress && this.l1Provider) {
      this.l1DepositorContractProvider = new ethers.Contract(
        this.config.l1ContractAddress,
        StarkNetBitcoinDepositorABI,
        this.l1Provider,
      ) as StarkNetBitcoinDepositor;
      logger.info(
        `StarknetChainHandler: L1 Depositor contract provider instance created in initialize() for ${this.config.chainName} at ${this.config.l1ContractAddress}`,
      );

      if (this.nonceManagerL1) {
        this.l1DepositorContract = new ethers.Contract(
          this.config.l1ContractAddress,
          StarkNetBitcoinDepositorABI,
          this.nonceManagerL1,
        ) as StarkNetBitcoinDepositor;
        logger.info(
          `StarknetChainHandler: L1 Depositor contract signer instance (with NonceManager) created in initialize() for ${this.config.chainName} at ${this.config.l1ContractAddress}`,
        );
      } else if (this.l1Signer) {
        logger.warn(
          `StarknetChainHandler: L1 NonceManager not available for ${this.config.chainName}, but L1 Signer is. L1 Depositor contract will use signer directly. Potential nonce issues.`,
        );
        this.l1DepositorContract = new ethers.Contract(
          this.config.l1ContractAddress,
          StarkNetBitcoinDepositorABI,
          this.l1Signer,
        ) as StarkNetBitcoinDepositor;
        logger.info(
          `StarknetChainHandler: L1 Depositor contract signer instance (without NonceManager) created in initialize() for ${this.config.chainName} at ${this.config.l1ContractAddress}`,
        );
      } else {
        logger.warn(
          `StarknetChainHandler: L1 signer/NonceManager not available after specific setup for ${this.config.chainName}. L1 Depositor contract (signer) transactions disabled. Read-only mode for L1 deposits.`,
        );
      }
    } else {
      logger.warn(
        `StarknetChainHandler: l1ContractAddress or l1Provider missing in initialize(). Cannot set up L1 depositor contracts for ${this.config.chainName}.`,
      );
    }

    if (
      this.config.starknetPrivateKey &&
      this.starknetProvider &&
      this.config.starknetDeployerAddress
    ) {
      try {
        this.starknetL2Account = new Account(
          this.starknetProvider,
          this.config.starknetDeployerAddress,
          this.config.starknetPrivateKey,
        );
        logger.info(
          `StarknetChainHandler: StarkNet L2 Account initialized for ${this.config.chainName} using deployer address ${this.config.starknetDeployerAddress}.`,
        );
      } catch (error: unknown) {
        logErrorContext(
          `StarknetChainHandler: Failed to initialize StarkNet L2 Account for ${this.config.chainName}: ${toSerializableError(error).message}`,
          error,
        );
      }
    } else {
      logger.warn(
        `StarknetChainHandler: StarkNet L2 Account could not be initialized for ${this.config.chainName} (private key, provider, or deployer address missing).`,
      );
    }

    await this.initializeL2();

    logger.info(`StarknetChainHandler: Full initialization complete for ${this.config.chainName}.`);
  }

  /**
   * Helper to build or update a Deposit object for L1 DepositInitialized event
   */
  private buildInitializedDeposit({
    depositId,
    l1Sender,
    destinationChainDepositOwner,
    transactionHash,
    baseDeposit,
    chainName,
  }: {
    depositId: string;
    l1Sender: string;
    destinationChainDepositOwner: string;
    transactionHash: string;
    baseDeposit?: Deposit;
    chainName: string;
  }): Deposit {
    const now = Date.now();
    const deposit: Deposit = {
      ...(baseDeposit || {}),
      id: depositId,
      status: DepositStatus.INITIALIZED,
      chainName,
      fundingTxHash: baseDeposit?.fundingTxHash || '',
      outputIndex: baseDeposit?.outputIndex || 0,
      hashes: {
        btc: baseDeposit?.hashes?.btc || { btcTxHash: '' },
        eth: {
          ...(baseDeposit?.hashes?.eth || {}),
          initializeTxHash: transactionHash,
          finalizeTxHash: baseDeposit?.hashes?.eth?.finalizeTxHash || null,
        },
        solana: baseDeposit?.hashes?.solana || { bridgeTxHash: null },
        starknet: baseDeposit?.hashes?.starknet || { l1BridgeTxHash: null, l2TxHash: null },
      },
      receipt: {
        ...(baseDeposit?.receipt || {}),
        depositor: l1Sender,
        blindingFactor: baseDeposit?.receipt?.blindingFactor || '',
        walletPublicKeyHash: baseDeposit?.receipt?.walletPublicKeyHash || '',
        refundPublicKeyHash: baseDeposit?.receipt?.refundPublicKeyHash || '',
        refundLocktime: baseDeposit?.receipt?.refundLocktime || '',
        extraData: baseDeposit?.receipt?.extraData || '',
      },
      owner: l1Sender,
      L1OutputEvent: {
        fundingTx: baseDeposit?.L1OutputEvent?.fundingTx || {
          version: '',
          inputVector: '',
          outputVector: '',
          locktime: '',
        },
        reveal: baseDeposit?.L1OutputEvent?.reveal || {
          fundingOutputIndex: 0,
          blindingFactor: '',
          walletPubKeyHash: '',
          refundPubKeyHash: '',
          refundLocktime: '',
          vault: '',
        },
        l2DepositOwner: destinationChainDepositOwner,
        l2Sender: baseDeposit?.L1OutputEvent?.l2Sender || '',
      },
      dates: {
        createdAt: baseDeposit?.dates?.createdAt || now,
        initializationAt: now,
        finalizationAt: baseDeposit?.dates?.finalizationAt || null,
        awaitingWormholeVAAMessageSince:
          baseDeposit?.dates?.awaitingWormholeVAAMessageSince || null,
        bridgedAt: baseDeposit?.dates?.bridgedAt || null,
        lastActivityAt: now,
      },
      wormholeInfo: baseDeposit?.wormholeInfo || {
        txHash: null,
        transferSequence: null,
        bridgingAttempted: false,
      },
      error: null,
    };
    return deposit;
  }

  /**
   * Handles the L1 DepositInitialized event.
   *
   * This event signifies that the deposit process has been formally initiated on L1.
   * The handler will:
   * 1. Convert the uint256 depositKey to a string for DepositStore ID.
   * 2. Fetch or create a Deposit record in DepositStore.
   * 3. Update the deposit's status to INITIALIZED.
   * 4. Store relevant information from the event: l1Sender (as owner),
   *    destinationChainDepositOwner (as L1OutputEvent.l2DepositOwner),
   *    and the L1 transaction hash for this initialization step (as hashes.eth.initializeTxHash).
   * 5. Set the initialization timestamp in dates.initializedAt.
   *
   * @param depositKey The unique identifier for the deposit (from event, uint256).
   * @param destinationChainDepositOwner The intended recipient on StarkNet, as bytes32 (from event).
   * @param l1Sender The address that initiated the deposit on L1 (from event).
   * @param event The full ethers.Event object.
   */
  protected async handleL1DepositInitialized(
    depositKey: ethers.BigNumber,
    destinationChainDepositOwner: string, // This is bytes32 from the event
    l1Sender: string,
    event: ethers.Event,
  ): Promise<void> {
    const depositId = depositKey.toString();
    const { transactionHash, blockNumber } = event;

    logger.info(
      {
        depositId,
        txHash: transactionHash,
        blockNumber,
        l1Sender,
        destinationChainDepositOwner,
        chain: this.config.chainName,
      },
      `Processing L1 DepositInitialized event for deposit ID: ${depositId}`,
    );

    try {
      const deposit = await DepositStore.getById(depositId);
      const oldStatus = deposit?.status;

      if (deposit && deposit.status >= DepositStatus.INITIALIZED) {
        logger.warn(
          {
            depositId,
            currentStatus: DepositStatus[deposit.status],
            txHash: transactionHash,
          },
          `Deposit ${depositId} already INITIALIZED or further. Skipping L1 DepositInitialized event processing.`,
        );
        return;
      }

      // Use helper to build the updated or new deposit
      const updatedDeposit = this.buildInitializedDeposit({
        depositId,
        l1Sender,
        destinationChainDepositOwner,
        transactionHash,
        baseDeposit: deposit || undefined,
        chainName: this.config.chainName,
      });

      if (deposit) {
        await DepositStore.update(updatedDeposit);
        logStatusChange(updatedDeposit, DepositStatus.INITIALIZED, oldStatus);
        logger.info(
          { depositId, newStatus: 'INITIALIZED', l1InitializedTxHash: transactionHash },
          `Deposit ${depositId} status updated to INITIALIZED.`,
        );
      } else {
        await DepositStore.create(updatedDeposit);
        logStatusChange(updatedDeposit, DepositStatus.INITIALIZED);
        logger.info(
          {
            depositId,
            newStatus: 'INITIALIZED',
            l1InitializedTxHash: transactionHash,
            createdNew: true,
          },
          `New deposit ${depositId} created and status set to INITIALIZED.`,
        );
      }
    } catch (error: unknown) {
      const errorDetails = toSerializableError(error);
      const errorMsg = `Error processing L1 DepositInitialized event for deposit ID ${depositId}.`;
      logErrorContext(`${errorMsg} Reason: ${errorDetails.message}`, error);
      logDepositError(
        depositId,
        errorMsg,
        {
          ...errorDetails,
          eventTxHash: transactionHash,
          eventBlockNumber: blockNumber,
        },
        this.config.chainName,
      );
    }
  }

  /**
   * Initializes the L2 components for the StarkNet handler as required by BaseChainHandler.
   * This includes setting up the StarkNet L2 provider and account if configured.
   */
  protected async initializeL2(): Promise<void> {
    // This method is called by BaseChainHandler's initialize() method.
    logger.info(
      `Initializing StarkNet L2 components for ${this.config.chainName} (called by BaseChainHandler)`,
    );

    if (
      this.config.l2Rpc &&
      this.config.starknetPrivateKey &&
      this.config.starknetDeployerAddress
    ) {
      logger.info(
        `StarkNet L2 RPC (${this.config.l2Rpc}), private key, and deployer address are configured for ${this.config.chainName}. Initializing StarkNet L2 provider and account.`,
      );

      try {
        // Initialize StarkNet L2 RPC provider
        this.starknetL2Provider = new RpcProvider({ nodeUrl: this.config.l2Rpc });
        logger.info(`StarkNet L2 RPC provider initialized for ${this.config.chainName}`);

        // Initialize StarkNet L2 account
        this.starknetL2Account = new Account(
          this.starknetL2Provider,
          this.config.starknetDeployerAddress,
          this.config.starknetPrivateKey,
          '1', // cairo version - ensure this is appropriate or configurable if needed
        );
        logger.info(
          `StarkNet L2 Account initialized for address ${this.config.starknetDeployerAddress} on ${this.config.chainName}`,
        );
      } catch (error: unknown) {
        logErrorContext(
          `Failed to initialize StarkNet L2 components for ${this.config.chainName}: ${toSerializableError(error).message}`,
          error,
        );
        logger.error(
          `Failed to initialize StarkNet L2 components for ${this.config.chainName}. This may affect L2-specific operations if any are performed. Error: ${toSerializableError(error).message}`,
        );
        // For now, we log the error and continue, as L1 monitoring is primary for deposits.
      }
    } else {
      logger.info(
        `StarkNet L2 RPC, private key, or deployer address not fully configured for ${this.config.chainName}. StarkNet L2 provider and account will not be initialized.`,
      );
    }
  }

  protected async setupL2Listeners(): Promise<void> {
    if (this.config.useEndpoint) {
      logger.info(
        `L1 event listeners for L1 Depositor (e.g., TBTCBridgedToStarkNet) skipped for ${this.config.chainName} (using Endpoint mode).`,
      );
      return;
    }

    if (!this.l1DepositorContractProvider) {
      logger.warn(
        `L1 Depositor contract provider not initialized for ${this.config.chainName}. Cannot set up TBTCBridgedToStarkNet event listener.`,
      );
      return;
    }

    logger.info(
      `Setting up L1 TBTCBridgedToStarkNet event listener for ${this.config.chainName} on contract ${this.l1DepositorContractProvider.address}`,
    );

    this.l1DepositorContractProvider.on(
      'TBTCBridgedToStarkNet',
      async (
        depositKey: string,
        starkNetRecipient: ethers.BigNumber,
        amount: ethers.BigNumber,
        messageNonce: ethers.BigNumber,
        event: ethers.Event,
      ) => {
        await this.processTBTCBridgedToStarkNetEvent(
          depositKey,
          starkNetRecipient,
          amount,
          messageNonce,
          event.transactionHash,
          false,
        );
      },
    );

    logger.info(`L1 TBTCBridgedToStarkNet event listener is active for ${this.config.chainName}`);

    if (this.config.l2StartBlock > 0) {
      this.checkForPastL1DepositorEvents({ fromBlock: this.config.l2StartBlock }).catch((error) => {
        logErrorContext(
          `Error during initial scan for past L1 Depositor bridge events for ${this.config.chainName}: ${toSerializableError(error).message}`,
          error,
        );
      });
    } else {
      logger.warn(
        `No specific l2StartBlock configured for ${this.config.chainName} for past L1 Depositor bridge events check. Consider adding a time-based fallback or specific config if past event scanning from genesis is too broad.`,
      );
    }
  }

  protected async checkForPastL1DepositorEvents(options: {
    fromBlock: number;
    toBlock?: number | 'latest';
  }): Promise<void> {
    if (!this.l1DepositorContractProvider) {
      logger.warn(
        `checkForPastL1DepositorEvents | L1 Depositor contract provider not available for ${this.config.chainName}. Skipping past event check.`,
      );
      return;
    }

    const toBlockWithDefault = options.toBlock || 'latest';
    logger.info(
      `Checking for past TBTCBridgedToStarkNet L1 events for ${this.config.chainName} from block ${options.fromBlock} to ${toBlockWithDefault}`,
    );

    try {
      const events = await this.l1DepositorContractProvider.queryFilter(
        this.l1DepositorContractProvider.filters.TBTCBridgedToStarkNet(),
        options.fromBlock,
        toBlockWithDefault,
      );

      if (events.length > 0) {
        logger.info(
          `Found ${events.length} past TBTCBridgedToStarkNet L1 events for ${this.config.chainName}`,
        );
        for (const event of events) {
          if (event.args) {
            const depositKey = event.args.depositKey as string;
            const starkNetRecipient = event.args.starkNetRecipient as ethers.BigNumber;
            const amount = event.args.amount as ethers.BigNumber;
            const messageNonce = event.args.messageNonce as ethers.BigNumber;
            await this.processTBTCBridgedToStarkNetEvent(
              depositKey,
              starkNetRecipient,
              amount,
              messageNonce,
              event.transactionHash,
              true,
            );
          } else {
            logger.warn(
              `checkForPastL1DepositorEvents | Event args undefined for past event. Tx: ${event.transactionHash}`,
            );
          }
        }
      } else {
        logger.info(
          `No past TBTCBridgedToStarkNet L1 events found for ${this.config.chainName} in the queried range.`,
        );
      }
    } catch (error: unknown) {
      logErrorContext(
        `Error querying past TBTCBridgedToStarkNet L1 events for ${this.config.chainName}: ${toSerializableError(error).message}`,
        error,
      );
    }
  }

  protected async processTBTCBridgedToStarkNetEvent(
    depositKeyOrId: string | BytesLike,
    starkNetRecipient: ethers.BigNumber,
    amount: ethers.BigNumber,
    messageNonce: ethers.BigNumber,
    transactionHash: string,
    isPastEvent: boolean = false,
  ): Promise<void> {
    const logPrefix = isPastEvent
      ? `PastEvent | TBTCBridgedToStarkNet for ${this.config.chainName}:`
      : `LiveEvent | TBTCBridgedToStarkNet for ${this.config.chainName}:`;

    const depositId =
      typeof depositKeyOrId === 'string' ? depositKeyOrId : ethers.utils.hexlify(depositKeyOrId);

    logger.info(
      `${logPrefix} Processing | DepositId: ${depositId} | Amount: ${amount.toString()} | StarkNet Recipient: ${starkNetRecipient.toString()} | L1 Tx: ${transactionHash} | Nonce: ${messageNonce.toString()}`,
    );

    try {
      const deposit = await DepositStore.getById(depositId);
      if (!deposit) {
        logger.warn(`${logPrefix} Unknown deposit. ID: ${depositId}. Ignoring.`);
        return;
      }

      if (deposit.status === DepositStatus.BRIDGED) {
        if (isPastEvent) {
          logger.debug(`${logPrefix} Deposit already BRIDGED. ID: ${depositId}. Skipping update.`);
        } else {
          logger.warn(
            `${logPrefix} Deposit already BRIDGED. ID: ${depositId}. Potential replay of live event. Skipping update.`,
          );
        }
        return;
      }

      if (deposit.chainName !== this.config.chainName) {
        logger.error(
          `${logPrefix} Mismatched chain for DepositKey ${depositId} (Deposit Chain: ${deposit.chainName}) processed by handler for Chain: ${this.config.chainName}. This indicates an issue with event routing or deposit ID uniqueness. Skipping update.`,
          { depositId, depositChain: deposit.chainName, handlerChain: this.config.chainName },
        );
        return;
      }

      logger.info(`${logPrefix} Updating deposit to BRIDGED | ID: ${depositId}`);

      deposit.status = DepositStatus.BRIDGED;
      deposit.dates.bridgedAt = Math.floor(Date.now() / 1000);

      deposit.hashes.starknet = {
        ...(deposit.hashes.starknet || {}),
        l1BridgeTxHash: transactionHash,
      };

      await DepositStore.update(deposit);
      logger.info(
        `${logPrefix} Deposit updated to BRIDGED. ID: ${depositId}. L1 Tx: ${transactionHash}`,
      );
    } catch (error: unknown) {
      logErrorContext(
        `Error processing TBTCBridgedToStarkNet event for ${this.config.chainName}: ${toSerializableError(error).message}`,
        error,
      );
    }
  }

  async getLatestBlock(): Promise<number> {
    if (this.config.useEndpoint) return 0;

    if (!this.starknetL2Provider) {
      logger.warn(
        `StarkNet L2 provider not available for ${this.config.chainName}. Cannot get latest block. Returning 0.`,
      );
      return 0;
    }

    try {
      logger.debug(`Fetching latest block number for ${this.config.chainName}`);
      const block = await this.starknetL2Provider.getBlock('latest');
      const blockNumber = block.block_number;

      logger.debug(`Latest block number for ${this.config.chainName}: ${blockNumber}`);

      return blockNumber;
    } catch (error: unknown) {
      const errorMsg = `Error fetching latest block for ${this.config.chainName}: ${toSerializableError(error).message}`;
      logger.error(errorMsg);
      logErrorContext(errorMsg, error);

      // Return 0 to avoid breaking the flow, but log the error for monitoring
      return 0;
    }
  }

  async checkForPastDeposits(options: {
    pastTimeInMinutes: number;
    latestBlock: number;
    batchSize?: number;
  }): Promise<void> {
    if (this.config.useEndpoint) {
      logger.info(
        `StarkNet checkForPastDeposits called for ${this.config.chainName} with pastTimeInMinutes: ${options.pastTimeInMinutes}, latestBlock: ${options.latestBlock}`,
      );

      if (!this.starknetProvider) {
        logger.error('StarkNet provider not initialized.');
        return;
      }
      if (!this.config.l2ContractAddress) {
        logger.warn(
          `L2 events contract address not configured for ${this.config.chainName}. Skipping L2 event check.`,
        );
        return;
      }
      // Check for l2EventsContractAbi existence on the instance
      if (!this.l2EventsContractAbi) {
        logger.warn(
          `L2 events contract ABI not configured for ${this.config.chainName}. Skipping L2 event parsing details, will rely on keys only.`,
        );
        // We can still proceed to check event keys if ABI for full parsing isn't there
      }

      const blocksToQuery = Math.floor(
        (options.pastTimeInMinutes * 60) / STARKNET_AVG_BLOCK_TIME_SECONDS,
      );
      const fromBlock = Math.max(0, options.latestBlock - blocksToQuery);
      const toBlock = options.latestBlock;

      if (fromBlock > toBlock) {
        logger.info(
          `StarkNet fromBlock ${fromBlock} is greater than toBlock ${toBlock}. No blocks to query.`,
        );
        return;
      }

      const eventSelector: string = num.toHex(hash.starknetKeccak(EXPECTED_L2_DEPOSIT_EVENT_NAME));
      logger.info(`Using event selector for "${EXPECTED_L2_DEPOSIT_EVENT_NAME}": ${eventSelector}`);

      const eventFilter = {
        from_block: { block_number: fromBlock },
        to_block: { block_number: toBlock },
        address: this.config.l2ContractAddress,
        keys: [[eventSelector]], // Filter by the specific event name hash
        chunk_size: options.batchSize || 100, // StarkNet.js default is 100 if not specified by RPC node
      };

      try {
        const eventsResponse = await this.starknetProvider.getEvents(eventFilter);
        logger.info(
          {
            chain: this.config.chainName,
            fromBlock,
            toBlock,
            address: this.config.l2ContractAddress,
            eventSelector,
            count: eventsResponse.events.length,
            continuationToken: eventsResponse.continuation_token,
          },
          `checkForPastDeposits | Found ${eventsResponse.events.length} potential '${EXPECTED_L2_DEPOSIT_EVENT_NAME}' events for ${this.config.chainName}`,
        );

        // Cast to unknown first, then to StarkNetRawEvent[] to assert the shape
        for (const emittedEvent of eventsResponse.events as unknown[] as StarkNetRawEvent[]) {
          // Basic check using event key (name hash)
          if (emittedEvent.keys && emittedEvent.keys[0] === eventSelector) {
            const l2TxHashString = emittedEvent.transaction_hash
              ? '0x' + emittedEvent.transaction_hash.toString(16)
              : `unknown_l2_tx_hash_for_block_${emittedEvent.block_hash}`;

            logger.info(
              {
                chain: this.config.chainName,
                l2TxHash: l2TxHashString,
                blockNumber: emittedEvent.block_number,
                blockHash: emittedEvent.block_hash,
              },
              `Found matching StarkNet L2 deposit event by key: ${EXPECTED_L2_DEPOSIT_EVENT_NAME}.`,
            );

            if (this.l2EventsContractAbi) {
              // Call processStarkNetDepositEvent for full parsing and handling.
              // This method is responsible for using the ABI to parse the event data,
              // extracting necessary details, creating/updating the deposit in DepositStore,
              // and calling handleDepositEvent.
              await this.processStarkNetDepositEvent(emittedEvent, this.l2EventsContractAbi);
            } else {
              logger.warn(
                {
                  chain: this.config.chainName,
                  l2TxHash: l2TxHashString,
                  blockNumber: emittedEvent.block_number,
                },
                `L2 events contract ABI for ${this.config.chainName} is missing. Cannot fully process event. Skipping detailed parsing and handling for this event. Raw event data and keys might be insufficient for full deposit lifecycle management.`,
              );
              // If ABI is missing, we cannot perform full parsing. Depending on requirements,
              // a minimal record might be created or an error logged for manual intervention.
              // For now, we skip creating a placeholder deposit from here to enforce the full parsing path.
            }
          }
        }
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error && error.message
            ? error.message
            : 'Unknown error fetching/processing StarkNet L2 events.';
        const errorDetails: Record<string, unknown> = {
          chain: this.config.chainName,
          fromBlock,
          toBlock,
          address: this.config.l2ContractAddress,
          eventSelector,
        };

        // Safely access potential properties of the error object
        if (typeof error === 'object' && error !== null) {
          const errWithDetails = error as ErrorWithDetails;
          if (
            errWithDetails.response &&
            typeof errWithDetails.response === 'object' &&
            errWithDetails.response.data
          ) {
            errorDetails.responseData = errWithDetails.response.data;
          }
          if (errWithDetails.code) {
            errorDetails.errorCode = errWithDetails.code;
          }
        }

        logger.error(
          {
            ...errorDetails,
            error: errorMessage,
            stack: error instanceof Error ? error.stack : undefined,
          },
          'Error in StarkNet checkForPastDeposits event loop.',
        );
        logDepositError(
          `batch_processing_error_${Date.now()}`,
          errorMessage,
          errorDetails,
          this.config.chainName,
        );
      }
    } else {
      logger.debug(
        `StarkNet checkForPastDeposits skipped for ${this.config.chainName} as useEndpoint is false.`,
      );
    }
  }

  private async processStarkNetDepositEvent(
    emittedEvent: StarkNetRawEvent, // Changed from 'any' to StarkNetRawEvent
    l2ContractAbi: Abi,
  ): Promise<void> {
    try {
      // Ensure transaction_hash is a hex string for parseEvents, as RPC.EmittedEvent expects.
      // Our StarkNetRawEvent has it as bigint based on provider.getEvents() behavior in v6.
      // For RPC.EmittedEvent, block_hash and block_number are optional or potentially not present
      // in the version used by the linter. Omit them to satisfy linter.
      const eventForParsing: RPC.EmittedEvent = {
        from_address: emittedEvent.from_address,
        keys: emittedEvent.keys,
        data: emittedEvent.data,
        transaction_hash: num.toHex(emittedEvent.transaction_hash), // Convert bigint to hex string
      };

      logger.debug(
        `processStarkNetDepositEvent | Processing event from tx: ${eventForParsing.transaction_hash}`,
      );

      const abiEvents = starknetEvents.getAbiEvents(l2ContractAbi);
      const abiStructs = CallData.getAbiStruct(l2ContractAbi);
      const abiEnums = CallData.getAbiEnum(l2ContractAbi);

      // starknetEvents.parseEvents expects an array of events
      const parsedEventsArray = starknetEvents.parseEvents(
        [eventForParsing], // Use the converted event
        abiEvents,
        abiStructs,
        abiEnums,
      );

      if (!parsedEventsArray || parsedEventsArray.length === 0) {
        logger.warn(
          `processStarkNetDepositEvent | Failed to parse event data for tx: ${eventForParsing.transaction_hash}`,
        );
        return;
      }

      const parsedEvent = parsedEventsArray[0]; // We passed a single event, so expect a single result
      const eventName = Object.keys(parsedEvent)[0];

      if (eventName !== EXPECTED_L2_DEPOSIT_EVENT_NAME) {
        logger.debug(
          `processStarkNetDepositEvent | Skipping event of type '${eventName}', expected '${EXPECTED_L2_DEPOSIT_EVENT_NAME}'. Tx: ${eventForParsing.transaction_hash}`,
        );
        return;
      }

      // Pass the parsed event (which is an object like { EventName: { param1: value1, ... } })
      // and the transaction hash to the next handler.
      // Ensure transaction_hash is string for handleDepositEvent
      const l2TransactionHashString: string = eventForParsing.transaction_hash; // Already a string now
      await this.handleDepositEvent(parsedEvent, l2TransactionHashString);
    } catch (error: unknown) {
      const errorDetails = toSerializableError(error);
      const originalTxHash = emittedEvent.transaction_hash
        ? num.toHex(emittedEvent.transaction_hash)
        : 'unknown_tx_hash';
      logErrorContext(
        `processStarkNetDepositEvent | Error processing StarkNet event for tx ${originalTxHash}: ${errorDetails.message}`,
        error,
      );
      logDepositError(
        originalTxHash,
        `Error processing StarkNet L2 event: ${errorDetails.message}`,
        errorDetails,
        this.config.chainName,
      );
    }
  }

  private async handleDepositEvent(
    parsedEvent: Record<string, Record<string, unknown>>, // Changed from Record<string, any>
    transactionHash: string,
  ): Promise<void> {
    const eventName = Object.keys(parsedEvent)[0];
    const eventPayload = parsedEvent[eventName];

    if (!eventPayload) {
      logger.error(
        `handleDepositEvent | Event payload is missing for event ${eventName}, tx ${transactionHash}. Cannot process.`,
      );
      logDepositError(
        transactionHash, // Using txHash as a temporary ID for this error context
        `Missing payload for L2 event ${eventName}`,
        { parsedEvent },
        this.config.chainName,
      );
      return;
    }

    // Attempt to extract a canonical depositId from the event payload.
    // IMPORTANT: Adjust 'deposit_id' to the actual field name from your StarkNet contract event ABI.
    let depositIdFromEvent: string | undefined;
    if (eventPayload.deposit_id) {
      // Assuming deposit_id could be a hex string, bigint, or number. Convert to string.
      depositIdFromEvent = String(eventPayload.deposit_id);
      if (typeof eventPayload.deposit_id === 'bigint') {
        depositIdFromEvent = num.toHex(eventPayload.deposit_id);
      }
      logger.info(
        `handleDepositEvent | Extracted depositId '${depositIdFromEvent}' from L2 event ${eventName} payload. Tx: ${transactionHash}`,
      );
    } else {
      // Fallback if no canonical deposit_id in payload: use L2 tx hash + event name as a temporary ID.
      // This situation should ideally be avoided by ensuring events emit a stable identifier.
      depositIdFromEvent = `starknet_l2_${transactionHash}_${eventName}`;
      logger.warn(
        `handleDepositEvent | Canonical deposit_id missing in L2 event ${eventName} payload. Using generated ID: ${depositIdFromEvent}. Tx: ${transactionHash}`,
      );
    }

    let deposit = await DepositStore.getById(depositIdFromEvent);
    const currentTime = Math.floor(Date.now() / 1000);
    let oldStatus: DepositStatus | undefined = deposit?.status;

    if (!deposit) {
      logger.info(
        `handleDepositEvent | No existing deposit found for ID '${depositIdFromEvent}'. Creating new entry based on L2 event ${eventName}.`,
      );
      deposit = {
        id: depositIdFromEvent,
        chainName: this.config.chainName,
        fundingTxHash: 'UNKNOWN_FROM_L2_EVENT', // To be filled by updateDepositFromL2Event if available in payload
        outputIndex: 0, // To be filled by updateDepositFromL2Event if available in payload
        hashes: {
          btc: { btcTxHash: 'UNKNOWN_FROM_L2_EVENT' },
          eth: { initializeTxHash: null, finalizeTxHash: null },
          solana: { bridgeTxHash: null }, // Assuming solana part of Deposit.hashes
          starknet: { l1BridgeTxHash: null, l2TxHash: null },
        },
        receipt: {
          // To be filled by updateDepositFromL2Event
          depositor: 'UNKNOWN_FROM_L2_EVENT',
          blindingFactor: '',
          walletPublicKeyHash: '',
          refundPublicKeyHash: '', // Corrected: refundPublicKeyHash (This is for Deposit.receipt, should be correct)
          refundLocktime: '',
          extraData: '',
        },
        owner: 'UNKNOWN_FROM_L2_EVENT', // To be filled by updateDepositFromL2Event
        status: DepositStatus.BRIDGED, // Default status for new L2-observed event
        L1OutputEvent: null,
        dates: {
          createdAt: currentTime, // Event observation time as creation time for this record
          initializationAt: null, // Direct assignment in new object
          finalizationAt: null,
          awaitingWormholeVAAMessageSince: null,
          bridgedAt: currentTime, // Event implies it's bridged now
          lastActivityAt: currentTime,
        },
        wormholeInfo: {
          // Initialize if part of Deposit type
          txHash: null,
          transferSequence: null,
          bridgingAttempted: false,
        },
        error: null,
      };
      oldStatus = undefined; // New deposit, so no old status
    } else {
      logger.info(
        `handleDepositEvent | Existing deposit found for ID '${depositIdFromEvent}'. Will update with L2 event ${eventName} details.`,
      );
      // Ensure L2 tx hash is updated if not already set, or if this is a new observation of it
      if (!deposit.hashes.starknet)
        deposit.hashes.starknet = { l1BridgeTxHash: null, l2TxHash: null };
      deposit.hashes.starknet.l2TxHash = transactionHash;
    }

    // Update the deposit with specific information from the L2 event payload
    await this.updateDepositFromL2Event(deposit, eventPayload, transactionHash);

    // Ensure deposit is non-null before calling functions that expect non-null Deposit
    if (!deposit) {
      // This state should ideally be unreachable given the logic above
      logger.error(
        `handleDepositEvent | CRITICAL: deposit object is null before final update for ID ${depositIdFromEvent}. This should not happen.`,
      );
      logDepositError(
        depositIdFromEvent,
        'Critical error: Deposit object became null unexpectedly in handleDepositEvent.',
        { eventName, transactionHash },
        this.config.chainName,
      );
      return;
    }

    // Save the updated or new deposit back to the store
    await DepositStore.update(deposit);
    logStatusChange(deposit, deposit.status, oldStatus);

    logger.info(
      `handleDepositEvent | Deposit '${deposit.id}' (L2 Tx: ${transactionHash}) processed successfully for event ${eventName}. Status: ${deposit.status}`,
    );
  }

  private async updateDepositFromL2Event(
    deposit: Deposit,
    eventPayload: Record<string, unknown>, // Changed from Record<string, any>
    transactionHash: string, // L2 transaction hash
  ): Promise<void> {
    logger.info(
      `updateDepositFromL2Event | Updating deposit '${deposit.id}' using L2 event data. L2 Tx: ${transactionHash}.`,
    );

    // Ensure L2 transaction hash is set in the deposit's hashes structure
    if (!deposit.hashes.starknet) {
      deposit.hashes.starknet = { l1BridgeTxHash: null, l2TxHash: null };
    }
    deposit.hashes.starknet.l2TxHash = transactionHash;

    // Update status and dates based on this L2 event
    // (TBTCDepositFinalizedOnL2 implies it's bridged)
    deposit.status = DepositStatus.BRIDGED;
    const currentTime = Math.floor(Date.now() / 1000);
    if (!deposit.dates.bridgedAt) {
      deposit.dates.bridgedAt = currentTime;
    }
    deposit.dates.lastActivityAt = currentTime;

    // Clear any previous errors as this event signifies successful L2 finalization
    deposit.error = null;

    // --- Populate deposit fields from eventPayload --- //
    // IMPORTANT: Adjust these field names (e.g., 'amount', 'recipient', 'l1_sender') to match your
    // actual StarkNet contract event ABI for TBTCDepositFinalizedOnL2.

    // Example: Amount (assuming eventPayload.amount is a bigint)
    if (eventPayload.amount !== undefined) {
      // Convert bigint amount to string or number as needed by Deposit.amount type
      // For now, assuming Deposit.amount can handle string representation of bigint.
      // If Deposit.amount is number, ensure no precision loss for large bigints.
      // deposit.amount = eventPayload.amount.toString(); // Or handle conversion appropriately
      logger.debug(
        `updateDepositFromL2Event | Payload amount: ${eventPayload.amount} (type: ${typeof eventPayload.amount})`,
      );
      // Assuming deposit.receipt.value is where amount is stored, or a top-level field like deposit.value
      // Let's assume it should go into receipt.value for now, if such a field exists on Deposit type.
      // If not, this needs to map to the correct field. This is a placeholder.
      if (deposit.receipt && typeof eventPayload.amount === 'bigint') {
        // deposit.receipt.value = eventPayload.amount.toString(); // Example if receipt has value
        // Or if there's a specific field like deposit.l2Amount
      }
    } else {
      logger.warn(
        `updateDepositFromL2Event | 'amount' field missing in L2 event payload for deposit ${deposit.id}`,
      );
    }

    // Example: Recipient / Owner (assuming eventPayload.recipient is a StarkNet address string)
    if (eventPayload.recipient) {
      const recipientAddress = String(eventPayload.recipient); // Ensure it's a string
      deposit.owner = recipientAddress; // Assuming 'owner' is the final L2 recipient
      logger.debug(`updateDepositFromL2Event | Updated deposit.owner to: ${recipientAddress}`);
      // If there's a specific l2Recipient field:
      // deposit.l2Recipient = recipientAddress;
    } else {
      logger.warn(
        `updateDepositFromL2Event | 'recipient' field missing in L2 event payload for deposit ${deposit.id}`,
      );
    }

    // Example: Original L1 sender/depositor (if available in L2 event, e.g., eventPayload.l1_sender)
    if (eventPayload.l1_sender) {
      deposit.receipt.depositor = String(eventPayload.l1_sender);
      logger.debug(
        `updateDepositFromL2Event | Updated deposit.receipt.depositor to: ${deposit.receipt.depositor}`,
      );
    } else {
      // Keep existing or UNKNOWN if not in event
      if (deposit.receipt.depositor === 'UNKNOWN_FROM_L2_EVENT') {
        logger.warn(
          `updateDepositFromL2Event | 'l1_sender' (for depositor) field missing in L2 event payload for deposit ${deposit.id}. Retaining placeholder.`,
        );
      }
    }

    // TODO: Map other relevant fields from eventPayload to the deposit object.
    // Systematically go through all "UNKNOWN_FROM_L2_EVENT" placeholders in the Deposit type
    // and try to populate them from eventPayload if the data exists in the event.
    // Examples:
    // deposit.fundingTxHash = eventPayload.l1_funding_tx_hash || deposit.fundingTxHash;
    // deposit.outputIndex = eventPayload.l1_output_index !== undefined ? Number(eventPayload.l1_output_index) : deposit.outputIndex;
    // deposit.receipt.blindingFactor = eventPayload.blinding_factor || deposit.receipt.blindingFactor;
    // deposit.receipt.walletPublicKeyHash = eventPayload.wallet_pk_hash || deposit.receipt.walletPublicKeyHash;
    // deposit.receipt.refundPublicKeyHash = eventPayload.refund_pk_hash || deposit.receipt.refundPublicKeyHash;
    // deposit.receipt.refundLocktime = eventPayload.refund_locktime || deposit.receipt.refundLocktime;
    // deposit.receipt.extraData = eventPayload.extra_data || deposit.receipt.extraData;

    // If any fields remain UNKNOWN after attempting to populate from event, log them.
    Object.keys(deposit.receipt).forEach((key) => {
      const rKey = key as keyof Deposit['receipt'];
      if (deposit.receipt[rKey] === 'UNKNOWN_FROM_L2_EVENT') {
        logger.warn(
          `updateDepositFromL2Event | Field deposit.receipt.${rKey} remains UNKNOWN for deposit ${deposit.id} after L2 event processing.`,
        );
      }
    });
    if (deposit.fundingTxHash === 'UNKNOWN_FROM_L2_EVENT') {
      logger.warn(
        `updateDepositFromL2Event | Field deposit.fundingTxHash remains UNKNOWN for deposit ${deposit.id}`,
      );
    }
    if (deposit.owner === 'UNKNOWN_FROM_L2_EVENT') {
      logger.warn(
        `updateDepositFromL2Event | Field deposit.owner remains UNKNOWN for deposit ${deposit.id}`,
      );
    }

    logger.info(
      `updateDepositFromL2Event | Finished updating deposit '${deposit.id}' from L2 event. Current status: ${deposit.status}`,
    );
  }

  /**
   * Finalize a deposit on the L1 StarkGate bridge.
   * This function is called when a deposit has been successfully minted on L2 (TBTC).
   * It marks the deposit as finalized on the L1 bridge.
   * @param deposit The deposit object.
   * @returns A promise that resolves with the transaction receipt if successful, otherwise undefined.
   */
  public async finalizeDeposit(
    deposit: Deposit,
  ): Promise<ethers.providers.TransactionReceipt | undefined> {
    // Add null safety check for L1OutputEvent
    if (!deposit.L1OutputEvent) {
      const logPrefix = `FINALIZE_DEPOSIT ${this.config.chainName} ${deposit.id} |`;
      logger.error(`${logPrefix} Deposit missing L1OutputEvent data. Cannot finalize deposit.`);
      await logDepositError(deposit.id, 'Deposit missing L1OutputEvent data for finalization.', {
        currentStatus: deposit.status,
      });
      return undefined;
    }

    const depositId = getDepositId(
      getFundingTxHash(deposit.L1OutputEvent.fundingTx),
      deposit.L1OutputEvent.reveal.fundingOutputIndex,
    );
    const logPrefix = `FINALIZE_DEPOSIT ${this.config.chainName} ${depositId} |`;

    logger.info(`${logPrefix} Attempting to finalize deposit on L1 Depositor contract.`);

    if (!this.l1DepositorContract) {
      logger.error(
        `${logPrefix} L1 Depositor contract (signer) instance not available. Cannot finalize deposit.`,
      );
      logErrorContext(
        `${logPrefix} L1 Depositor contract (signer) not available`,
        new Error('L1 Depositor contract (signer) not available'),
      );
      await logDepositError(
        deposit.id,
        'L1 Depositor contract (signer) instance not available for finalization.',
        { internalError: 'L1 Depositor contract (signer) not available' },
      );
      return undefined;
    }

    if (!deposit.hashes.starknet?.l2TxHash) {
      logger.warn(
        `${logPrefix} Deposit does not have an L2 transaction hash (starknet.l2TxHash). Cannot trigger L1 finalization. Ensure L2 minting is confirmed.`,
      );
      await logDepositError(
        deposit.id,
        'Deposit missing L2 transaction hash. L2 minting not confirmed before L1 finalization attempt.',
        {
          currentStatus: deposit.status,
        },
      );
      return undefined;
    }

    const dynamicFee: ethers.BigNumber =
      await this.l1DepositorContract.quoteFinalizeDepositDynamic();
    logger.info(
      `${logPrefix} Dynamically quoted L1->L2 message fee: ${ethers.utils.formatEther(dynamicFee)} ETH (includes 10% buffer)`,
    );

    const txOverrides: PayableOverrides = {
      value: dynamicFee,
    };

    try {
      logger.info(
        `${logPrefix} Calling L1 Depositor contract finalizeDeposit for depositKey: ${depositId} with fee: ${ethers.utils.formatEther(txOverrides.value as BigNumberish)} ETH.`,
      );

      const txResponse = await this.l1DepositorContract.finalizeDeposit(depositId, txOverrides);

      logger.info(
        `${logPrefix} L1 finalizeDeposit transaction sent. TxHash: ${txResponse.hash}. Waiting for confirmations...`,
      );

      const txReceipt = await txResponse.wait(this.config.l1Confirmations);

      if (txReceipt.status === 1) {
        logger.info(
          `${logPrefix} L1 finalizeDeposit transaction successful. TxHash: ${txReceipt.transactionHash}, Block: ${txReceipt.blockNumber}.`,
        );
        // Create adapter object that matches TransactionWithHash interface
        const txHashAdapter = { hash: txReceipt.transactionHash };
        await updateToFinalizedDeposit(deposit, txHashAdapter);
        return txReceipt;
      } else {
        const revertMsg = `${logPrefix} L1 finalizeDeposit transaction reverted. TxHash: ${txReceipt.transactionHash}, Block: ${txReceipt.blockNumber}.`;
        logger.error(revertMsg);
        logErrorContext(revertMsg, { receipt: txReceipt });
        await logDepositError(
          deposit.id,
          `L1 finalizeDeposit tx reverted: ${txReceipt.transactionHash}`,
          {
            receipt: txReceipt,
          },
        );
        return undefined;
      }
    } catch (error: unknown) {
      const reason = toSerializableError(error).message;
      logger.error(`FINALIZE | ERROR | ID: ${deposit.id} | Reason: ${reason}`, error);
      logErrorContext(`FINALIZE | ERROR | ID: ${deposit.id} | Reason: ${reason}`, error);
      logDepositError(
        deposit.id,
        `Failed to finalize deposit: ${reason}`,
        toSerializableError(error),
        deposit.chainName,
      );
      // Mark as error to potentially prevent immediate retries depending on cleanup logic
      updateToFinalizedDeposit(deposit, undefined, `Error: ${reason}`);
      return undefined;
    }
  }

  /**
   * Initialize a deposit on the L1 StarkGate bridge.
   * This function is called when a new deposit is detected (e.g., from a Bitcoin transaction).
   * It prepares the deposit on the L1 bridge for eventual minting on L2 (TBTC).
   *
   * @param deposit The deposit object containing all necessary L1 event data.
   * @returns A promise that resolves with the L1 transaction receipt if successful, otherwise undefined.
   */
  public async initializeDeposit(
    deposit: Deposit,
  ): Promise<ethers.providers.TransactionReceipt | undefined> {
    // Add null safety check for L1OutputEvent
    if (!deposit.L1OutputEvent) {
      const logPrefix = `INITIALIZE_DEPOSIT ${this.config.chainName} ${deposit.id} |`;
      logger.error(`${logPrefix} Deposit missing L1OutputEvent data. Cannot initialize deposit.`);
      await logDepositError(deposit.id, 'Deposit missing L1OutputEvent data for initialization.', {
        currentStatus: deposit.status,
      });
      return undefined;
    }

    const fundingTxHash = getFundingTxHash(deposit.L1OutputEvent.fundingTx);
    const depositKeyBytes32 = getDepositId(
      fundingTxHash,
      deposit.L1OutputEvent.reveal.fundingOutputIndex,
    );
    const logId = deposit.id || depositKeyBytes32;
    const logPrefix = `INITIALIZE_DEPOSIT ${this.config.chainName} ${logId} |`;

    logger.info(`${logPrefix} Attempting to initialize deposit on L1 Depositor contract.`);

    if (!this.l1DepositorContract) {
      logger.error(
        `${logPrefix} L1 Depositor contract (signer) instance not available. Cannot initialize deposit.`,
      );
      logErrorContext(
        `${logPrefix} L1 Depositor contract (signer) not available`,
        new Error('L1 Depositor contract (signer) not available'),
      );
      await logDepositError(
        logId,
        'L1 Depositor contract (signer) instance not available for initialization.',
        { internalError: 'L1 Depositor contract (signer) not available' },
      );
      return undefined;
    }

    const fundingTx: FundingTransaction = deposit.L1OutputEvent.fundingTx;
    const reveal: Reveal = deposit.L1OutputEvent.reveal;
    const l2DepositOwner: string = deposit.L1OutputEvent.l2DepositOwner;

    if (!validateStarkNetAddress(l2DepositOwner)) {
      logger.error(`${logPrefix} Invalid StarkNet recipient address: ${l2DepositOwner}`);
      await logDepositError(logId, 'Invalid StarkNet recipient address.', {
        address: l2DepositOwner,
      });
      return undefined;
    }
    const formattedL2DepositOwnerAsBytes32 = formatStarkNetAddressForContract(l2DepositOwner);

    const txOverrides: ethers.PayableOverrides = {
      value: ethers.BigNumber.from(this.config.l1FeeAmountWei), // Ensure l1FeeAmountWei is defined and a BigNumber
    };

    try {
      logger.info(
        `${logPrefix} Calling L1 Depositor contract initializeDeposit for StarkNet recipient (as _depositOwner/extraData): ${formattedL2DepositOwnerAsBytes32} (original: ${l2DepositOwner})`,
      );
      logger.debug(`${logPrefix} L1 Contract Funding Tx Arg:`, fundingTx);
      logger.debug(`${logPrefix} L1 Contract Reveal Arg:`, reveal);

      const txResponse = await this.l1DepositorContract.initializeDeposit(
        fundingTx,
        reveal,
        formattedL2DepositOwnerAsBytes32,
        txOverrides,
      );

      logger.info(
        `${logPrefix} L1 initializeDeposit transaction sent. TxHash: ${txResponse.hash}. Waiting for confirmations...`,
      );
      deposit.hashes.eth.initializeTxHash = txResponse.hash;

      const txReceipt = await txResponse.wait(this.config.l1Confirmations);

      if (txReceipt.status === 1) {
        logger.info(
          `${logPrefix} L1 initializeDeposit transaction successful. TxHash: ${txReceipt.transactionHash}, Block: ${txReceipt.blockNumber}.`,
        );
        // Create adapter object that matches TransactionWithHash interface
        const txHashAdapter = { hash: txReceipt.transactionHash };
        await updateToInitializedDeposit(deposit, txHashAdapter);
        return txReceipt;
      } else {
        const revertMsg = `${logPrefix} L1 initializeDeposit transaction reverted. TxHash: ${txReceipt.transactionHash}, Block: ${txReceipt.blockNumber}.`;
        logger.error(revertMsg);
        logErrorContext(revertMsg, { receipt: txReceipt });
        await logDepositError(
          logId,
          `L1 initializeDeposit tx reverted: ${txReceipt.transactionHash}`,
          { receipt: txReceipt },
        );
        deposit.status = DepositStatus.QUEUED;
        logStatusChange(deposit, DepositStatus.QUEUED, DepositStatus.INITIALIZED);
        await DepositStore.update(deposit);
        return undefined;
      }
    } catch (error: unknown) {
      const reason = toSerializableError(error).message;
      logger.error(`INITIALIZE | ERROR | ID: ${deposit.id} | Reason: ${reason}`, error);
      logErrorContext(`INITIALIZE | ERROR | ID: ${deposit.id} | Reason: ${reason}`, error);
      logDepositError(
        deposit.id,
        `Failed to initialize deposit: ${reason}`,
        toSerializableError(error),
        deposit.chainName,
      );
      // Update status to reflect error, preventing immediate retries unless logic changes
      updateToInitializedDeposit(deposit, undefined, `Error: ${reason}`);
      return undefined;
    }
  }

  /**
   * Checks if the tBTC protocol has finalized the minting for a given deposit.
   * This is determined by querying for the OptimisticMintingFinalized event on the TBTCVault contract.
   * @param deposit The deposit to check.
   * @returns True if the minting is confirmed, false otherwise.
   */
  protected async hasDepositBeenMintedOnTBTC(deposit: Deposit): Promise<boolean> {
    if (!this.tbtcVaultProvider) {
      logger.warn(
        `hasDepositBeenMintedOnTBTC | TBTCVault provider not available for ${this.config.chainName}. Cannot check minting status for deposit ${deposit.id}.`,
      );
      return false;
    }

    const depositKeyUint256 = ethers.BigNumber.from(deposit.id);

    try {
      logger.debug(
        `hasDepositBeenMintedOnTBTC | Checking for OptimisticMintingFinalized event for depositKey ${deposit.id} (uint256: ${depositKeyUint256.toString()}) on chain ${this.config.chainName}`,
      );

      let fromBlock: number | undefined = undefined;
      if (deposit.hashes.eth.initializeTxHash) {
        try {
          const txReceipt = await this.l1Provider.getTransactionReceipt(
            deposit.hashes.eth.initializeTxHash,
          );
          if (txReceipt) {
            fromBlock = txReceipt.blockNumber - 10;
          }
        } catch (receiptError: unknown) {
          logger.warn(
            `hasDepositBeenMintedOnTBTC | Error fetching receipt for l1InitializeTxHash ${deposit.hashes.eth.initializeTxHash} to determine fromBlock: ${receiptError instanceof Error ? receiptError.message : String(receiptError)}`,
          );
        }
      }
      if (!fromBlock) {
        fromBlock = this.config.l2StartBlock > 0 ? this.config.l2StartBlock - 10 : undefined;
      }

      if (fromBlock) {
        logger.info(
          `hasDepositBeenMintedOnTBTC | Checking for OptimisticMintingFinalized event for depositKey ${deposit.id} (uint256: ${depositKeyUint256.toString()}) on chain ${this.config.chainName} from block ${fromBlock}`,
        );

        const events = await this.tbtcVaultProvider.queryFilter(
          this.tbtcVaultProvider.filters.OptimisticMintingFinalized(depositKeyUint256),
          fromBlock,
        );

        if (events.length > 0) {
          logger.info(
            `hasDepositBeenMintedOnTBTC | Found ${events.length} OptimisticMintingFinalized event for depositKey ${deposit.id} on chain ${this.config.chainName}`,
          );
          return true;
        } else {
          logger.info(
            `hasDepositBeenMintedOnTBTC | No OptimisticMintingFinalized event found for depositKey ${deposit.id} on chain ${this.config.chainName} in the queried range.`,
          );
          return false;
        }
      } else {
        logger.warn(
          `hasDepositBeenMintedOnTBTC | No valid fromBlock determined for depositKey ${deposit.id} on chain ${this.config.chainName}. Cannot check minting status.`,
        );
        return false;
      }
    } catch (error: unknown) {
      logErrorContext(
        `Error checking if deposit ${deposit.id} has been minted on tBTC: ${toSerializableError(error).message}`,
        error,
      );
      logger.error(
        `Error checking if deposit ${deposit.id} has been minted on tBTC: ${toSerializableError(error).message}`,
      );
      logDepositError(
        deposit.id,
        `Error checking if deposit has been minted on tBTC: ${toSerializableError(error).message}`,
        toSerializableError(error),
        deposit.chainName,
      );
      return false;
    }
  }
}
