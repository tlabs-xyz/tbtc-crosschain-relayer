/**
 * BaseChainHandler: Abstract base class for cross-chain handler implementations.
 *
 * This class provides common logic for L1 setup, event listening, and deposit lifecycle management
 * for EVM and non-EVM chains. It defines abstract methods for L2-specific logic, which must be implemented
 * by subclasses for each supported chain (e.g., StarkNet, Solana, Sui).
 *
 * Update this file to add, refactor, or clarify shared chain handler logic and contracts.
 */
import { type Network, type Wormhole, wormhole } from '@wormhole-foundation/sdk';

import solana from '@wormhole-foundation/sdk/solana';
import sui from '@wormhole-foundation/sdk/sui';
import evm from '@wormhole-foundation/sdk/evm';

import { BigNumber } from 'ethers';
import * as AllEthers from 'ethers';
import type { TransactionReceipt } from '@ethersproject/providers';
import { NonceManager } from '@ethersproject/experimental';

import type { ChainHandlerInterface } from '../interfaces/ChainHandler.interface.js';
import { NETWORK } from '../config/schemas/common.schema.js';
import type { Deposit } from '../types/Deposit.type.js';
import logger, { logErrorContext } from '../utils/Logger.js';
import { DepositStore } from '../utils/DepositStore.js';
import { updateToInitializedDeposit, updateToFinalizedDeposit } from '../utils/Deposits.js';
import { DepositStatus } from '../types/DepositStatus.enum.js';
import { L1BitcoinDepositorABI } from '../interfaces/L1BitcoinDepositor.js';
import { TBTCVaultABI } from '../interfaces/TBTCVault.js';
import { logDepositError } from '../utils/AuditLog.js';
import type { AnyChainConfig } from '../config/index.js';
import { CHAIN_TYPE } from '../config/schemas/common.schema.js';
import type { EvmChainConfig } from '../config/schemas/evm.chain.schema.js';
import { TIMEOUTS } from '../utils/Constants.js';
import { toSerializableError } from '../types/Error.types.js';

// Helper function to extract error reason without using any
function getErrorReason(error: unknown): string {
  if (error instanceof Error) {
    // Check for ethers.js error with reason property
    const ethersError = error as Error & { reason?: string };
    return ethersError.reason ?? error.message;
  }
  return String(error);
}

export abstract class BaseChainHandler<T extends AnyChainConfig> implements ChainHandlerInterface {
  protected l1Provider: AllEthers.providers.JsonRpcProvider;
  protected l1Signer: AllEthers.Wallet;
  protected nonceManagerL1: NonceManager;
  protected l1BitcoinDepositor: AllEthers.Contract; // For sending L1 txs
  protected tbtcVault: AllEthers.Contract; // For sending L1 txs (though not used currently)
  protected l1BitcoinDepositorProvider: AllEthers.Contract; // For L1 reads/events
  protected tbtcVaultProvider: AllEthers.Contract; // For L1 events
  public config: T;
  protected wormhole: Wormhole<Network>;

  constructor(config: T) {
    this.config = config;
  }

  // =====================
  // Initialization Logic
  // =====================

  /**
   * Initialize the chain handler, including L1 provider, signer, contracts, and Wormhole SDK.
   * Subclasses must implement initializeL2 for L2-specific setup.
   */
  async initialize(): Promise<void> {
    logger.info(`Initializing chain handler for ${this.config.chainName}`);

    // --- L1 Setup ---
    // Common L1 configuration checks
    if (
      !this.config.l1Rpc ||
      !this.config.l1ContractAddress ||
      !this.config.vaultAddress ||
      !this.config.network
    ) {
      throw new Error(
        `Missing required L1 RPC/Contract/Vault/Network configuration for ${this.config.chainName}`,
      );
    }

    // Initialize L1 provider first as it's needed by the signer
    this.l1Provider = new AllEthers.providers.JsonRpcProvider(this.config.l1Rpc);

    // EVM-specific L1 setup (Signer)
    if (this.config.chainType === CHAIN_TYPE.EVM) {
      const evmConfig = this.config as EvmChainConfig;
      if (!evmConfig.privateKey) {
        throw new Error(`Missing privateKey for EVM chain ${this.config.chainName}`);
      }
      this.l1Signer = new AllEthers.Wallet(evmConfig.privateKey, this.l1Provider);
      this.nonceManagerL1 = new NonceManager(this.l1Signer);

      // L1 Contracts for transactions (require signer)
      this.l1BitcoinDepositor = new AllEthers.Contract(
        this.config.l1ContractAddress,
        L1BitcoinDepositorABI,
        this.nonceManagerL1,
      );
      this.tbtcVault = new AllEthers.Contract(
        this.config.vaultAddress,
        TBTCVaultABI,
        this.l1Signer,
      );
    } else {
      // For non-EVM chains, l1Signer and related contracts might not be needed
      // or would require a different setup.
      logger.warn(
        `L1 Signer and transaction-capable contracts not initialized for non-EVM chain ${this.config.chainName} in BaseChainHandler. This might be expected.`,
      );
    }

    const ethereumNetwork =
      (this.config.network as NETWORK) === NETWORK.DEVNET
        ? NETWORK.TESTNET
        : (this.config.network as NETWORK);

    this.wormhole = await wormhole(ethereumNetwork, [evm, solana, sui], {
      chains: {
        Solana: {
          rpc: this.config.l2Rpc,
        },
      },
    });

    // L1 Contracts for reading/listening (do not require signer)
    this.l1BitcoinDepositorProvider = new AllEthers.Contract(
      this.config.l1ContractAddress,
      L1BitcoinDepositorABI,
      this.l1Provider,
    );
    this.tbtcVaultProvider = new AllEthers.Contract(
      this.config.vaultAddress,
      TBTCVaultABI,
      this.l1Provider,
    );

    // --- L2 Setup (delegated to subclasses) ---
    this.initializeL2();

    logger.info(`Chain handler initialized for ${this.config.chainName}`);
  }

  /**
   * Set up all event listeners (L1 and L2).
   * Subclasses must implement setupL2Listeners for L2-specific event handling.
   */
  async setupListeners(): Promise<void> {
    await this.setupL1Listeners();
    await this.setupL2Listeners();
    logger.info(`Event listeners active for ${this.config.chainName}`);
  }

  /**
   * Set up L1 event listeners for deposit lifecycle events.
   * Handles OptimisticMintingFinalized and related events.
   */
  protected async setupL1Listeners(): Promise<void> {
    this.tbtcVaultProvider.on(
      'OptimisticMintingFinalized',
      async (_minter, depositKey, _depositor, _optimisticMintingDebt) => {
        try {
          const BigDepositKey = BigNumber.from(depositKey);
          const depositId = BigDepositKey.toString();
          const deposit: Deposit | null = await DepositStore.getById(depositId);
          if (deposit) {
            // Check if already finalized to avoid redundant calls/logs
            if (deposit.status !== DepositStatus.FINALIZED) {
              this.finalizeDeposit(deposit);
            }
          } else {
            logger.warn(
              `Received OptimisticMintingFinalized event for unknown Deposit Key: ${depositId}`,
            );
          }
        } catch (error: unknown) {
          logErrorContext(
            `Error in OptimisticMintingFinalized handler: ${error instanceof Error ? error.message : String(error)}`,
            error,
          );
          logDepositError(
            depositKey?.toString() ?? 'unknown-deposit-key',
            `Error processing OptimisticMintingFinalized event for key ${depositKey?.toString()}`,
            toSerializableError(error),
            this.config.chainName,
          );
        }
      },
    );
  }

  /**
   * Initialize a deposit on L1. Returns the transaction receipt if successful.
   * Handles error logging and updates deposit status on failure.
   * @param deposit The deposit object to initialize
   */
  async initializeDeposit(deposit: Deposit): Promise<TransactionReceipt | undefined> {
    // Check if already processed locally to avoid redundant L1 calls
    if (
      deposit.status === DepositStatus.INITIALIZED ||
      deposit.status === DepositStatus.FINALIZED
    ) {
      logger.warn(
        `INITIALIZE | Deposit already processed locally | ID: ${deposit.id} | STATUS: ${DepositStatus[deposit.status]}`,
      );
      return undefined;
    }
    if (!deposit.L1OutputEvent) {
      const errorMsg = 'Missing L1OutputEvent data for initialization';
      logErrorContext(
        `INITIALIZE | ERROR | Missing L1OutputEvent data | ID: ${deposit.id}`,
        new Error(errorMsg),
      );
      logDepositError(
        deposit.id,
        errorMsg,
        toSerializableError(new Error(errorMsg)),
        deposit.chainName,
      );
      updateToInitializedDeposit(deposit, undefined, 'Missing L1OutputEvent data'); // Mark as error
      return undefined;
    }

    try {
      // Pre-call check against L1BitcoinDepositor using the provider instance
      await this.l1BitcoinDepositorProvider.callStatic.initializeDeposit(
        deposit.L1OutputEvent.fundingTx,
        deposit.L1OutputEvent.reveal,
        deposit.L1OutputEvent.l2DepositOwner,
      );

      const currentNonce = await this.nonceManagerL1.getTransactionCount('latest');

      // Send transaction using L1BitcoinDepositor with nonce manager
      const tx = await this.l1BitcoinDepositor.initializeDeposit(
        deposit.L1OutputEvent.fundingTx,
        deposit.L1OutputEvent.reveal,
        deposit.L1OutputEvent.l2DepositOwner,
        { nonce: currentNonce },
      );

      logger.info(`INITIALIZE | Transaction sent | ID: ${deposit.id} | TxHash: ${tx.hash}`);

      // Wait for the transaction to be mined
      const receipt = await tx.wait();
      logger.info(
        `INITIALIZE | Transaction mined | ID: ${deposit.id} | Block: ${receipt.blockNumber}`,
      );

      // Update the deposit status in the JSON storage upon successful mining
      updateToInitializedDeposit(deposit, receipt, undefined); // Pass receipt for txHash etc.

      return receipt; // Return the receipt for further processing if needed
    } catch (error: unknown) {
      // Error Handling - Check if it's a specific revert reason or common issue
      const reason = getErrorReason(error);
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
   * Finalize a deposit on L1. Returns the transaction receipt if successful.
   * Handles error logging and updates deposit status on failure.
   * @param deposit The deposit object to finalize
   */
  async finalizeDeposit(deposit: Deposit): Promise<TransactionReceipt | undefined> {
    // Check if already finalized to avoid redundant L1 calls
    if (deposit.status === DepositStatus.FINALIZED) {
      logger.warn(`FINALIZE | Deposit already finalized | ID: ${deposit.id}`);
      return undefined;
    }

    // Check for required data
    if (!deposit.hashes.eth.initializeTxHash) {
      const errorMsg = 'Missing initializeTxHash for finalization';
      logErrorContext(
        `FINALIZE | ERROR | Missing initializeTxHash | ID: ${deposit.id}`,
        new Error(errorMsg),
      );
      logDepositError(
        deposit.id,
        errorMsg,
        toSerializableError(new Error(errorMsg)),
        deposit.chainName,
      );
      updateToFinalizedDeposit(deposit, undefined, 'Missing initializeTxHash'); // Mark as error
      return undefined;
    }

    try {
      // Quote L1 fee
      const value = await this.l1BitcoinDepositorProvider.finalizationFee();

      // Pre-call check against L1BitcoinDepositor using the provider instance
      await this.l1BitcoinDepositorProvider.callStatic.finalizeDeposit(
        deposit.hashes.eth.initializeTxHash,
        { value },
      );

      const currentNonce = await this.nonceManagerL1.getTransactionCount('latest');

      // Send transaction using L1BitcoinDepositor with nonce manager
      const tx = await this.l1BitcoinDepositor.finalizeDeposit(
        deposit.hashes.eth.initializeTxHash,
        {
          value,
          nonce: currentNonce,
        },
      );

      logger.info(`FINALIZE | Transaction sent | ID: ${deposit.id} | TxHash: ${tx.hash}`);

      // Wait for the transaction to be mined
      const receipt = await tx.wait();
      logger.info(
        `FINALIZE | Transaction mined | ID: ${deposit.id} | Block: ${receipt.blockNumber}`,
      );

      // Update the deposit status in the JSON storage upon successful mining
      updateToFinalizedDeposit(deposit, receipt, undefined);

      return receipt;
    } catch (error: unknown) {
      const errorMessage = getErrorReason(error);
      logger.error(`FINALIZE | Failed for ID: ${deposit.id} | Error: ${errorMessage}`);
      logErrorContext(`FINALIZE | ERROR | ID: ${deposit.id}`, error);
      logDepositError(deposit.id, errorMessage, toSerializableError(error), deposit.chainName);
      updateToFinalizedDeposit(deposit, undefined, errorMessage);
      return undefined;
    }
  }

  /**
   * Check the status of a deposit by ID. Returns the DepositStatus or null if not found.
   * @param depositId The deposit ID to check
   */
  async checkDepositStatus(depositId: string): Promise<DepositStatus | null> {
    try {
      // Use the L1 provider contract to check status
      const status: number = await this.l1BitcoinDepositorProvider.deposits(depositId);
      // Ensure the status is a valid enum value before returning
      if (Object.values(DepositStatus).includes(status as DepositStatus)) {
        return status as DepositStatus;
      } else {
        logger.warn(
          `L1BitcoinDepositor returned invalid status (${status}) for deposit ID: ${depositId}`,
        );
        return null; // Indicate invalid status received
      }
    } catch (error: unknown) {
      // Check if the error indicates the deposit doesn't exist (e.g., contract reverts)
      // This depends heavily on the specific contract behavior for invalid IDs.
      // For now, assume any error means status is uncertain.
      const reason = getErrorReason(error);
      logErrorContext(`Error fetching L1 deposit status for ID ${depositId}: ${reason}`, error);
      return null; // Indicate status couldn't be reliably fetched
    }
  }

  /**
   * Process all deposits that need initialization. Subclasses may override for custom logic.
   */
  async processInitializeDeposits(): Promise<void> {
    logger.info(`Processing initialize deposits for ${this.config.chainName}`);
    const operations: Deposit[] = await DepositStore.getByStatus(DepositStatus.QUEUED);
    const filteredOperations: Deposit[] = this.filterDepositsActivityTime(operations);

    if (filteredOperations.length === 0) {
      return;
    }

    for (const deposit of filteredOperations) {
      const updatedDeposit = await DepositStore.getById(deposit.id);
      if (!updatedDeposit) {
        continue;
      }

      // Double-check status to avoid race conditions
      if (
        updatedDeposit.status === DepositStatus.INITIALIZED ||
        updatedDeposit.status === DepositStatus.FINALIZED
      ) {
        continue;
      }

      await this.initializeDeposit(updatedDeposit);
    }
  }

  /**
   * Process all deposits that need finalization. Subclasses may override for custom logic.
   */
  async processFinalizeDeposits(): Promise<void> {
    logger.info(`Processing finalize deposits for ${this.config.chainName}`);
    const operations: Deposit[] = await DepositStore.getByStatus(DepositStatus.INITIALIZED);
    const filteredOperations: Deposit[] = this.filterDepositsActivityTime(operations);

    if (filteredOperations.length === 0) {
      return;
    }

    for (const deposit of filteredOperations) {
      const updatedDeposit = await DepositStore.getById(deposit.id);
      if (!updatedDeposit) {
        continue;
      }

      // Double-check status to avoid race conditions
      if (updatedDeposit.status === DepositStatus.FINALIZED) {
        continue;
      }

      await this.finalizeDeposit(updatedDeposit);
    }
  }

  /**
   * L2-specific initialization logic. Must be implemented by subclasses.
   */
  protected abstract initializeL2(): void;

  /**
   * Set up L2 event listeners. Must be implemented by subclasses.
   */
  protected abstract setupL2Listeners(): Promise<void>;

  /**
   * Get the latest block/slot/sequence number for the chain. Must be implemented by subclasses.
   */
  abstract getLatestBlock(): Promise<number>;

  /**
   * Check for past deposits within a given time window. Must be implemented by subclasses.
   * @param options Options for past deposit checking (time window, latest block, batch size)
   */
  abstract checkForPastDeposits(options: {
    pastTimeInMinutes: number;
    latestBlock: number; // Represents block/slot/sequence number
    batchSize?: number;
  }): Promise<void>;

  /**
   * Whether this handler supports past deposit checking (default: true).
   */
  supportsPastDepositCheck(): boolean {
    // True only if L2 is configured (implying L2 watcher capability) AND endpoint is not used.
    const supports = !!(
      this.config.l2Rpc &&
      this.config.l2ContractAddress &&
      !this.config.useEndpoint
    );
    return supports;
  }

  /**
   * Filter deposits by last activity time. Used for cleanup or reporting.
   * @param deposits Array of Deposit objects
   */
  protected filterDepositsActivityTime(deposits: Array<Deposit>): Array<Deposit> {
    const now = Date.now();
    return deposits.filter((deposit) => {
      // If lastActivityAt doesn't exist yet (e.g., freshly created via listener/endpoint), process immediately
      if (!deposit.dates.lastActivityAt) return true;
      // Otherwise, process only if enough time has passed since last activity
      return now - deposit.dates.lastActivityAt > TIMEOUTS.DEFAULT_DEPOSIT_RETRY_MS;
    });
  }
}
