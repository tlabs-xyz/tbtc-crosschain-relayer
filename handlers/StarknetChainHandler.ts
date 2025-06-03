import type { StarknetChainConfig } from '../config/schemas/starknet.chain.schema.js';
import { StarknetChainConfigSchema } from '../config/schemas/starknet.chain.schema.js';
import logger from '../utils/Logger.js';
import { BaseChainHandler } from './BaseChainHandler.js';
import {
  ethers,
  type Overrides,
  type PayableOverrides,
  type BigNumberish,
  type BytesLike,
} from 'ethers';
import { StarkNetBitcoinDepositorABI } from '../interfaces/StarkNetBitcoinDepositor.js';
import type { StarkNetBitcoinDepositor } from '../interfaces/IStarkNetBitcoinDepositor.js';
import type { RpcProvider, Account } from 'starknet';

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
import { logErrorContext } from '../utils/Logger.js';
import type { FundingTransaction } from '../types/FundingTransaction.type.js';
import { toSerializableError } from '../types/Error.types.js';

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

  constructor(config: StarknetChainConfig) {
    super(config);
    try {
      StarknetChainConfigSchema.parse(config);
      logger.info(`StarknetChainHandler constructed and validated for ${this.config.chainName}`);
    } catch (error: unknown) {
      logger.error(
        `Invalid StarkNet configuration for ${config.chainName}: ${toSerializableError(error).message}`,
      );
      throw new Error(
        `Invalid StarkNet configuration for ${config.chainName}. Please check logs for details.`,
      );
    }

    logger.debug(`StarknetChainHandler setup complete for ${this.config.chainName}`);
  }

  protected async initializeL2(): Promise<void> {
    logger.info(`Initializing StarkNet L1 components for ${this.config.chainName}`);

    if (!this.l1Provider) {
      logger.error(
        `L1 provider not available (l1Rpc not configured or failed to init in Base). StarkNet L1 contract interactions disabled for ${this.config.chainName}.`,
      );
      throw new Error(
        `L1 provider is required for StarkNet L1 components but is not initialized for ${this.config.chainName}.`,
      );
    }

    if (!this.config.l1ContractAddress) {
      logger.error(
        `L1 Contract Address (l1ContractAddress) for StarkGate bridge not configured for ${this.config.chainName}. Cannot initialize L1 components.`,
      );
      throw new Error(
        `Missing l1ContractAddress for StarkNet handler on ${this.config.chainName}.`,
      );
    }

    try {
      // For read-only operations and event listening:
      this.l1DepositorContractProvider = new ethers.Contract(
        this.config.l1ContractAddress,
        StarkNetBitcoinDepositorABI,
        this.l1Provider,
      ) as StarkNetBitcoinDepositor;
      logger.info(
        `L1 Depositor contract provider instance created for ${this.config.chainName} at ${this.config.l1ContractAddress}`,
      );

      // For sending transactions (if signer is available via BaseChainHandler's init)
      if (this.nonceManagerL1) {
        this.l1DepositorContract = new ethers.Contract(
          this.config.l1ContractAddress,
          StarkNetBitcoinDepositorABI,
          this.nonceManagerL1,
        ) as StarkNetBitcoinDepositor;
        logger.info(
          `L1 Depositor contract signer instance (with NonceManager) created for ${this.config.chainName} at ${this.config.l1ContractAddress}`,
        );
      } else if (this.l1Signer) {
        logger.warn(
          `L1 NonceManager not available for ${this.config.chainName}, but L1 Signer is. L1 Depositor contract will use signer directly. This might lead to nonce issues if not handled carefully.`,
        );
        this.l1DepositorContract = new ethers.Contract(
          this.config.l1ContractAddress,
          StarkNetBitcoinDepositorABI,
          this.l1Signer,
        ) as StarkNetBitcoinDepositor;
        logger.info(
          `L1 Depositor contract signer instance (without NonceManager) created for ${this.config.chainName} at ${this.config.l1ContractAddress}`,
        );
      } else {
        logger.warn(
          `L1 signer not available for ${this.config.chainName} (privateKey not configured or failed to init in Base). L1 Depositor contract transactions disabled. Read-only mode.`,
        );
      }
    } catch (error: unknown) {
      logErrorContext(
        `Failed to instantiate StarkGate L1 contract instances for ${this.config.chainName}: ${toSerializableError(error).message}`,
        error,
      );
      logger.error(
        `Failed to instantiate StarkGate L1 contract instances for ${this.config.chainName}. Error: ${toSerializableError(error).message}`,
      );
      throw error;
    }

    if (this.config.l2Rpc && this.config.starknetPrivateKey) {
      logger.info(
        `StarkNet L2 RPC (${this.config.l2Rpc}) and private key are configured for ${this.config.chainName}. Initializing StarkNet L2 provider and account.`,
      );

      try {
        // Dynamic import of starknet.js to handle potential dependency issues
        // In test environment, this might be mocked
        let starknetModule: {
          RpcProvider: new (config: { nodeUrl: string }) => RpcProvider;
          Account: new (provider: RpcProvider, address: string, privateKey: string) => Account;
        };
        if (process.env.NODE_ENV === 'test') {
          // For tests, try to use the mocked module if available
          try {
            starknetModule = await import('starknet');
          } catch {
            // Fallback - if import fails, try require as last resort
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            starknetModule = require('starknet');
          }
        } else {
          starknetModule = await import('starknet');
        }

        const { RpcProvider, Account } = starknetModule;

        // Initialize StarkNet L2 RPC provider
        this.starknetL2Provider = new RpcProvider({ nodeUrl: this.config.l2Rpc });
        logger.info(`StarkNet L2 RPC provider initialized for ${this.config.chainName}`);

        // Validate that deployer address is provided
        if (!this.config.starknetDeployerAddress) {
          throw new Error(
            `StarkNet deployer address (starknetDeployerAddress) is required for L2 account initialization but not configured for ${this.config.chainName}`,
          );
        }

        // Initialize StarkNet L2 account for transactions
        this.starknetL2Account = new Account(
          this.starknetL2Provider,
          this.config.starknetDeployerAddress,
          this.config.starknetPrivateKey,
        );
        logger.info(
          `StarkNet L2 account initialized for ${this.config.chainName} with deployer address: ${this.config.starknetDeployerAddress}`,
        );

        // Verify the account by checking its address
        const accountAddress = this.starknetL2Account?.address;
        logger.info(`StarkNet L2 account address: ${accountAddress}`);
      } catch (error: unknown) {
        const errorMsg = `Failed to initialize StarkNet L2 provider/account for ${this.config.chainName}: ${toSerializableError(error).message}`;
        logger.error(errorMsg);
        logErrorContext(errorMsg, error);
        throw new Error(errorMsg);
      }
    } else {
      logger.warn(
        `StarkNet L2 RPC or starknetPrivateKey not configured for ${this.config.chainName}. Full StarkNet L2 features (direct L2 interaction) will be disabled.`,
      );
    }
    logger.info(`StarkNet L1 components initialization finished for ${this.config.chainName}.`);
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
    latestBlock: number; // Represents block number
  }): Promise<void> {
    if (this.config.useEndpoint) return;

    if (!this.starknetL2Provider) {
      logger.warn(
        `StarkNet L2 provider not available for ${this.config.chainName}. Cannot check for past deposits.`,
      );
      return;
    }

    if (
      !this.config.l2ContractAddress ||
      this.config.l2ContractAddress === '0x0000000000000000000000000000000000000000'
    ) {
      logger.warn(
        `L2 contract address not configured for ${this.config.chainName}. Cannot check for past deposits.`,
      );
      return;
    }

    try {
      logger.info(
        `Checking for past deposits on ${this.config.chainName} for the last ${options.pastTimeInMinutes} minutes`,
      );

      // Calculate approximate start block based on time
      // StarkNet has ~4 minute block time, so we use a conservative estimate
      const avgBlockTimeMinutes = 4;
      const estimatedBlocksBack = Math.ceil(options.pastTimeInMinutes / avgBlockTimeMinutes);
      const startBlock = Math.max(0, options.latestBlock - estimatedBlocksBack);

      logger.debug(
        `Searching for events from block ${startBlock} to ${options.latestBlock} on ${this.config.chainName}`,
      );

      // Query for relevant deposit events
      // Note: Event selectors would need to be defined based on the actual StarkNet contract events
      // This is a placeholder structure - actual implementation would depend on the specific events
      const eventFilter = {
        from_block: { block_number: startBlock },
        to_block: { block_number: options.latestBlock },
        address: this.config.l2ContractAddress,
        keys: [],
        chunk_size: 100,
      };

      logger.debug(`Event filter for ${this.config.chainName}:`, eventFilter);

      // Query events with pagination support
      const events = await this.starknetL2Provider.getEvents(eventFilter);

      if (events.events && events.events.length > 0) {
        logger.info(
          `Found ${events.events.length} past deposit events for ${this.config.chainName}`,
        );

        // Process each event
        for (const event of events.events) {
          await this.processStarkNetDepositEvent(event);
        }
      } else {
        logger.info(
          `No past deposit events found for ${this.config.chainName} in the queried range.`,
        );
      }
    } catch (error: unknown) {
      const errorMsg = `Error checking for past deposits on ${this.config.chainName}: ${toSerializableError(error).message}`;
      logger.error(errorMsg);
      logErrorContext(errorMsg, error);
    }
  }

  /**
   * Process a StarkNet deposit event
   * This method would be implemented based on the specific event structure
   * @param event The StarkNet event to process
   */
  private async processStarkNetDepositEvent(event: Record<string, unknown>): Promise<void> {
    try {
      logger.debug(`Processing StarkNet deposit event:`, event);

      // StarkNet events have the structure: { from_address, keys, data }
      // keys[0] is the event selector/name, keys[1...] are indexed parameters
      // data contains the non-indexed event parameters

      const fromAddress = event.from_address as string;
      const keys = event.keys as string[];
      const data = event.data as string[];

      if (!fromAddress || !keys || !data) {
        logger.warn(
          `Invalid StarkNet event structure for ${this.config.chainName}. Missing required fields (from_address, keys, data).`,
          event,
        );
        return;
      }

      if (!this.config.l2ContractAddress || fromAddress !== this.config.l2ContractAddress) {
        logger.debug(
          `Ignoring event from ${fromAddress} as it doesn't match configured L2 contract address ${this.config.l2ContractAddress} for ${this.config.chainName}`,
        );
        return;
      }

      if (keys.length === 0) {
        logger.warn(
          `StarkNet event missing event selector in keys for ${this.config.chainName}`,
          event,
        );
        return;
      }

      const eventSelector = keys[0];
      logger.debug(
        `Processing StarkNet event with selector ${eventSelector} from ${fromAddress} for ${this.config.chainName}`,
      );

      // Handle different types of deposit-related events based on selector
      // This is a basic implementation - specific event selectors would need to be
      // defined based on the actual StarkNet contract's ABI

      // For now, we treat any event from the L2 contract as a potential deposit event
      // and attempt to extract deposit information from the event data
      await this.handleDepositEvent(eventSelector, keys.slice(1), data);
    } catch (error: unknown) {
      const errorMsg = `Error processing StarkNet deposit event: ${toSerializableError(error).message}`;
      logger.error(errorMsg);
      logErrorContext(errorMsg, error);
    }
  }

  /**
   * Handle a specific deposit event based on its selector and data
   * @param eventSelector The event selector (first key)
   * @param indexedParams Additional indexed parameters (keys[1:])
   * @param eventData Non-indexed event data
   */
  private async handleDepositEvent(
    eventSelector: string,
    indexedParams: string[],
    eventData: string[],
  ): Promise<void> {
    try {
      // Basic event handling - in a real implementation, you would decode based on
      // specific event selectors from the contract ABI

      // Example: If this is a "DepositInitialized" event, we might expect:
      // - indexedParams[0]: deposit key/id
      // - eventData[0]: amount
      // - eventData[1]: recipient address

      if (indexedParams.length === 0) {
        logger.debug(
          `No indexed parameters in StarkNet deposit event with selector ${eventSelector} for ${this.config.chainName}`,
        );
        return;
      }

      // Extract potential deposit ID from first indexed parameter
      const potentialDepositId = indexedParams[0];

      if (!potentialDepositId) {
        logger.warn(
          `Missing deposit ID in StarkNet event for ${this.config.chainName}. Selector: ${eventSelector}`,
        );
        return;
      }

      // Try to find existing deposit by ID
      const existingDeposit = await DepositStore.getById(potentialDepositId);

      if (!existingDeposit) {
        logger.debug(
          `No existing deposit found with ID ${potentialDepositId} for StarkNet event on ${this.config.chainName}. This might be a new deposit or unrelated event.`,
        );
        return;
      }

      // Update deposit with L2 information if this is a relevant event
      await this.updateDepositFromL2Event(existingDeposit, eventSelector, indexedParams, eventData);
    } catch (error: unknown) {
      const errorMsg = `Error handling StarkNet deposit event with selector ${eventSelector}: ${toSerializableError(error).message}`;
      logger.error(errorMsg);
      logErrorContext(errorMsg, error);
    }
  }

  /**
   * Update deposit record based on L2 event information
   * @param deposit Existing deposit to update
   * @param eventSelector Event selector
   * @param indexedParams Indexed event parameters
   * @param eventData Non-indexed event data
   */
  private async updateDepositFromL2Event(
    deposit: Deposit,
    eventSelector: string,
    indexedParams: string[],
    eventData: string[],
  ): Promise<void> {
    try {
      const logPrefix = `STARKNET_L2_EVENT ${this.config.chainName} ${deposit.id} |`;

      logger.info(
        `${logPrefix} Processing L2 event with selector ${eventSelector} for deposit ${deposit.id}`,
      );

      // Extract transaction hash if available in the event context
      // Note: The transaction hash would typically be provided by the event listener context
      const l2TxHash = (indexedParams[1] || eventData[0]) as string;

      // Update deposit with L2 transaction information
      if (l2TxHash && !deposit.hashes.starknet?.l2TxHash) {
        const updatedDeposit: Deposit = {
          ...deposit,
          hashes: {
            ...deposit.hashes,
            starknet: {
              l2TxHash: l2TxHash,
            },
          },
          dates: {
            ...deposit.dates,
            lastActivityAt: Date.now(),
          },
        };

        await DepositStore.update(updatedDeposit);

        logger.info(`${logPrefix} Updated deposit with L2 transaction hash: ${l2TxHash}`);

        await logStatusChange(updatedDeposit, updatedDeposit.status, deposit.status);
      } else {
        logger.debug(`${logPrefix} No L2 transaction hash to update or hash already exists`);
      }
    } catch (error: unknown) {
      const errorMsg = `Error updating deposit from L2 event: ${toSerializableError(error).message}`;
      logger.error(errorMsg);
      logErrorContext(errorMsg, error);

      await logDepositError(
        deposit.id,
        `Failed to update deposit from L2 event: ${errorMsg}`,
        toSerializableError(error),
        deposit.chainName,
      );
    }
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

    const txOverrides: Overrides = {}; // No value needed for non-payable function

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
