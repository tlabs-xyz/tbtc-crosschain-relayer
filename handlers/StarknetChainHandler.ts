import { CHAIN_TYPE } from '../config/schemas/common.schema.js';
import type { StarknetChainConfig } from '../config/schemas/starknet.chain.schema.js';
import { StarknetChainConfigSchema } from '../config/schemas/starknet.chain.schema.js';
import logger from '../utils/Logger.js';
import { BaseChainHandler } from './BaseChainHandler.js';
import { ethers } from 'ethers'; // Ethers import for Contract
import type { IStarkGateBridge, EthersStarkGateBridge } from '../interfaces/IStarkGateBridge.js'; // IStarkGateBridge type
import { IStarkGateBridgeABI } from '../interfaces/IStarkGateBridge.abi.js'; // The ABI we just created
import crypto from 'crypto'; // For SHA256 hashing for deposit ID

// Custom type imports for Deposit processing
import { DepositStore } from '../utils/DepositStore.js';
import { DepositStatus } from '../types/DepositStatus.enum.js'; // Corrected path
// import { logDepositError, logDepositInfo } from '../utils/AuditLog.js'; // Uncomment when AuditLog is confirmed
import {
  validateStarkNetAddress,
  formatStarkNetAddressForContract,
  extractAddressFromBitcoinScript,
} from '../utils/starknetAddress.js'; // Address utilities
import type { Deposit } from '../types/Deposit.type.js'; // Deposit type
import type { Reveal } from '../types/Reveal.type.js'; // Reveal type
import { getFundingTxHash } from '../utils/GetTransactionHash.js'; // To get fundingTxHash
import { createDeposit as createDepositUtil, getDepositId } from '../utils/Deposits.js'; // Renamed to avoid conflict
import { logDepositError, logDepositInfo } from '../utils/AuditLog.js'; // Assuming AuditLog is available
import type { FundingTransaction } from '../types/FundingTransaction.type.js'; // For L1 contract call

// Placeholder for StarkNet specific imports (e.g., starknet.js)

export class StarknetChainHandler extends BaseChainHandler<StarknetChainConfig> {
  // --- L1 StarkGate Contract Instances ---
  /** L1 StarkGate contract instance for sending transactions (uses L1 signer with nonce manager) */
  protected starkGateContract: EthersStarkGateBridge | undefined;
  /** L1 StarkGate contract instance for read-only operations and event listening (uses L1 provider) */
  protected starkGateContractProvider: EthersStarkGateBridge | undefined;

  // StarkNet L2 specific provider/account (to be initialized in later tasks)
  // protected starknetL2Provider: RpcProvider | undefined;
  // protected starknetL2Account: Account | undefined;

  constructor(config: StarknetChainConfig) {
    super(config);
    // Validate config using Zod schema first
    try {
      StarknetChainConfigSchema.parse(config);
      // Assuming chainId is available in StarknetChainConfig after merging with CommonChainConfigSchema
      // If not, this log might need adjustment or chainId added to the specific StarkNet config.
      // Based on StarknetChainConfigSchema, it inherits from CommonChainConfigSchema which has chainId.
      logger.info(
        `StarknetChainHandler constructed and validated for ${this.config.chainName} (Chain ID: ${this.config.chainId})`,
      );
    } catch (error: any) {
      // Log the detailed Zod validation error
      logger.error(
        `Invalid StarkNet configuration for ${config.chainName}: ${error.message}`,
        { zodErrors: error.errors } // Include Zod error details for better debugging
      );
      // Throw a new error to halt initialization if config is invalid
      throw new Error(
        `Invalid StarkNet configuration for ${config.chainName}. Please check logs for details.`,
      );
    }
    // The explicit chainType check below is now largely redundant due to Zod schema validation,
    // but doesn't harm. It could be removed if desired to rely solely on Zod.
    // For now, keeping it as a defense-in-depth, though Zod should catch it first.
    if (config.chainType !== CHAIN_TYPE.STARKNET) {
      // This case should ideally be caught by Zod schema validation above.
      const errMsg = `Incorrect chain type ${config.chainType} provided to StarknetChainHandler for ${this.config.chainName}. Expected ${CHAIN_TYPE.STARKNET}.`;
      logger.error(errMsg);
      throw new Error(errMsg);
    }

    logger.debug(`StarknetChainHandler setup complete for ${this.config.chainName}`);
  }

  protected async initializeL2(): Promise<void> {
    // BaseChainHandler's initialize() is assumed to have set up:
    // this.l1Provider, this.l1Signer, this.nonceManagerL1
    // if config.l1Rpc and config.privateKey were provided.

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
      this.starkGateContractProvider = new ethers.Contract(
        this.config.l1ContractAddress,
        IStarkGateBridgeABI,
        this.l1Provider,
      ) as EthersStarkGateBridge; // Cast to our specific combined type
      logger.info(
        `StarkGate L1 contract provider instance created for ${this.config.chainName} at ${this.config.l1ContractAddress}`,
      );

      // For sending transactions (if signer is available via BaseChainHandler's init)
      if (this.nonceManagerL1) {
        this.starkGateContract = new ethers.Contract(
          this.config.l1ContractAddress,
          IStarkGateBridgeABI,
          this.nonceManagerL1, // Use nonceManager for tx sequencing
        ) as EthersStarkGateBridge;
        logger.info(
          `StarkGate L1 contract signer instance (with NonceManager) created for ${this.config.chainName} at ${this.config.l1ContractAddress}`,
        );
      } else if (this.l1Signer) {
        logger.warn(
          `L1 NonceManager not available for ${this.config.chainName}, but L1 Signer is. StarkGate L1 contract will use signer directly. This might lead to nonce issues if not handled carefully.`,
        );
        this.starkGateContract = new ethers.Contract(
          this.config.l1ContractAddress,
          IStarkGateBridgeABI,
          this.l1Signer,
        ) as EthersStarkGateBridge;
        logger.info(
          `StarkGate L1 contract signer instance (without NonceManager) created for ${this.config.chainName} at ${this.config.l1ContractAddress}`,
        );
      } else {
        logger.warn(
          `L1 signer not available for ${this.config.chainName} (privateKey not configured or failed to init in Base). StarkGate L1 contract transactions disabled. Read-only mode.`,
        );
      }
    } catch (error: any) {
      logger.error(
        `Failed to instantiate StarkGate L1 contract instances for ${this.config.chainName}: ${error.message}`,
        error,
      );
      throw new Error(
        `Failed to instantiate StarkGate L1 contract instances for ${this.config.chainName}. Error: ${error.message}`,
      );
    }

    // Perform a simple health check - e.g., try to call a read-only function
    try {
      if (this.starkGateContractProvider) {
        const fee = await this.starkGateContractProvider.l1ToL2MessageFee();
        logger.info(
          `StarkGate L1 contract health check successful for ${this.config.chainName}. Current l1ToL2MessageFee: ${fee.toString()}`,
        );
      } else {
        // This case should ideally not be reached if instantiation was successful or threw above.
        throw new Error(
          'StarkGate L1 contract provider instance not available for health check after attempted instantiation.',
        );
      }
    } catch (error: any) {
      logger.error(
        `StarkGate L1 contract health check failed for ${this.config.chainName} (l1ContractAddress: ${this.config.l1ContractAddress}): ${error.message}`,
        error,
      );
      throw new Error(
        `StarkGate L1 contract health check failed for ${this.config.chainName}. Error: ${error.message}`,
      );
    }

    // StarkNet L2 provider initialization (actual L2 connection using starknet.js)
    // This part is deferred as per "L1-Only Initialization" focus.
    if (this.config.l2Rpc && this.config.starknetPrivateKey) {
      logger.info(
        `StarkNet L2 RPC (${this.config.l2Rpc}) and private key are configured for ${this.config.chainName}. Actual StarkNet L2 provider/account initialization will be handled in a subsequent task.`,
      );
      // TODO: Initialize StarkNet L2 provider and account (e.g., using starknet.js RpcProvider, Account)
      // Example:
      // const { RpcProvider, Account } = await import('starknet');
      // this.starknetL2Provider = new RpcProvider({ nodeUrl: this.config.l2Rpc });
      // this.starknetL2Account = new Account(this.starknetL2Provider, this.config.starknetDeployerAddress, this.config.starknetPrivateKey);
      // logger.info(`StarkNet L2 provider and account would be initialized here for ${this.config.chainName}`);
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
        `L1 event listeners for StarkGate (TBTCBridgedToStarkNet) skipped for ${this.config.chainName} (using Endpoint mode).`,
      );
      return;
    }

    if (!this.starkGateContractProvider) {
      logger.warn(
        `StarkGate L1 contract provider not initialized for ${this.config.chainName}. Cannot set up TBTCBridgedToStarkNet event listener.`,
      );
      return;
    }

    logger.info(
      `Setting up L1 TBTCBridgedToStarkNet event listener for ${this.config.chainName} on contract ${this.starkGateContractProvider.address}`,
    );

    this.starkGateContractProvider.on(
      this.starkGateContractProvider.filters.TBTCBridgedToStarkNet(),
      async (
        depositKey: string,
        amount: ethers.BigNumber,
        starkNetRecipient: string,
        event: ethers.Event,
      ) => {
        await this.processTBTCBridgedToStarkNetEvent(
          depositKey,
          amount,
          starkNetRecipient,
          event.transactionHash,
          false, // isPastEvent = false
        );
      },
    );

    logger.info(
      `L1 TBTCBridgedToStarkNet event listener is active for ${this.config.chainName}`,
    );

    // Check for past events after setting up the live listener.
    // Using l2StartBlock from common config as the L1 starting point for this chain type.
    if (this.config.l2StartBlock > 0) {
      // Intentionally not awaiting this, to allow startup to complete while past events are scanned.
      this.checkForPastStarkGateBridgeEvents({ fromBlock: this.config.l2StartBlock }).catch(
        (error) => {
          logger.error(
            `Error during initial scan for past StarkGate bridge events for ${this.config.chainName}: ${error.message}`,
            error,
          );
        },
      );
    } else {
      logger.warn(
        `No specific l2StartBlock configured for ${this.config.chainName} for past StarkGate bridge events check. Consider adding a time-based fallback or specific config if past event scanning from genesis is too broad.`,
      );
    }
  }

  protected async checkForPastStarkGateBridgeEvents(options: {
    fromBlock: number;
    toBlock?: number | 'latest';
  }): Promise<void> {
    if (!this.starkGateContractProvider) {
      logger.warn(
        `checkForPastStarkGateBridgeEvents | StarkGate L1 contract provider not available for ${this.config.chainName}. Skipping past event check.`,
      );
      return;
    }

    const toBlockWithDefault = options.toBlock || 'latest';
    logger.info(
      `Checking for past TBTCBridgedToStarkNet L1 events for ${this.config.chainName} from block ${options.fromBlock} to ${toBlockWithDefault}`,
    );

    try {
      const events = await this.starkGateContractProvider.queryFilter(
        this.starkGateContractProvider.filters.TBTCBridgedToStarkNet(),
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
            const amount = event.args.amount as ethers.BigNumber;
            const starkNetRecipient = event.args.starkNetRecipient as string;
            await this.processTBTCBridgedToStarkNetEvent(
              depositKey,
              amount,
              starkNetRecipient,
              event.transactionHash,
              true, // isPastEvent = true
            );
          } else {
            logger.warn(
              `checkForPastStarkGateBridgeEvents | Event args undefined for past event. Tx: ${event.transactionHash}`,
            );
          }
        }
      } else {
        logger.info(
          `No past TBTCBridgedToStarkNet L1 events found for ${this.config.chainName} in the queried range.`,
        );
      }
    } catch (error: any) {
      logger.error(
        `Error querying past TBTCBridgedToStarkNet L1 events for ${this.config.chainName}: ${error.message}`,
        error,
      );
      // Consider if specific error types warrant different handling or re-throwing
    }
  }

  protected async processTBTCBridgedToStarkNetEvent(
    depositKey: string,
    amount: ethers.BigNumber,
    starkNetRecipient: string,
    transactionHash: string,
    isPastEvent: boolean = false,
  ): Promise<void> {
    const logPrefix = isPastEvent
      ? `PastEvent | TBTCBridgedToStarkNet for ${this.config.chainName}:`
      : `LiveEvent | TBTCBridgedToStarkNet for ${this.config.chainName}:`;
    logger.info(
      `${logPrefix} Processing | DepositKey: ${depositKey} | Amount: ${amount.toString()} | StarkNet Recipient: ${starkNetRecipient} | L1 Tx: ${transactionHash}`,
    );

    // Assuming depositKey from the event is the primary ID used in DepositStore.
    // This needs to be consistent with how deposits are created/identified for StarkNet.
    const depositId = depositKey;

    try {
      const deposit = await DepositStore.getById(depositId);
      if (!deposit) {
        logger.warn(`${logPrefix} Unknown deposit. ID: ${depositId}. Ignoring.`);
        // logDepositError(depositId, 'TBTCBridgedToStarkNet event for unknown deposit', { transactionHash, isPastEvent });
        return;
      }

      // Idempotency check: if already BRIDGED, log differently for past vs live events.
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

      // Additional check: Ensure the deposit belongs to this chain handler instance.
      // This is a safeguard, as filtering should ideally happen at a higher level or via specific event topics if possible.
      if (deposit.chainId !== this.config.chainId) {
        logger.error(
          `${logPrefix} Mismatched chainId! Event for DepositKey ${depositId} (Chain: ${deposit.chainId}) processed by handler for Chain: ${this.config.chainId}. This indicates an issue with event routing or deposit ID uniqueness. Skipping update.`,
        );
        // logDepositError(depositId, 'TBTCBridgedToStarkNet event chainId mismatch', { expectedChainId: this.config.chainId, actualChainId: deposit.chainId, transactionHash });
        return;
      }

      logger.info(`${logPrefix} Updating deposit to BRIDGED | ID: ${depositId}`);

      deposit.status = DepositStatus.BRIDGED;
      deposit.dates.bridgedAt = Math.floor(Date.now() / 1000); // Consider using L1 block timestamp if available and preferred
      deposit.hashes.starknet = {
        ...(deposit.hashes.starknet || {}), // Preserve existing starknet hashes like l2TxHash
        l1BridgeTxHash: transactionHash, // L1 Tx hash that emitted this event
      };
      // If you need to store recipient and amount directly on deposit (ensure fields exist in Deposit.type.ts):
      // deposit.starkNetRecipient = starkNetRecipient;
      // deposit.bridgedAmount = amount.toString();

      await DepositStore.update(deposit);
      logger.info(
        `${logPrefix} Deposit updated to BRIDGED. ID: ${depositId}. L1 Tx: ${transactionHash}`,
      );
      // logDepositInfo(depositId, `Deposit status updated to BRIDGED. L1 Tx: ${transactionHash}. Processed from ${isPastEvent ? 'past event scan' : 'live event'}.`);

      // TODO: Optionally, emit a local event or trigger further actions if the application requires it.
      // For example: this.emit('depositBridgedOnL1', deposit);
    } catch (error: any) {
      logger.error(
        `${logPrefix} Error processing event data for DepositKey ${depositKey}: ${error.message}`,
        error,
      );
      // logDepositError(depositId, `Error processing TBTCBridgedToStarkNet event data: ${error.message}`, { error, transactionHash, isPastEvent });
    }
  }

  async getLatestBlock(): Promise<number> {
    if (this.config.useEndpoint) return 0;
    logger.warn(
      `StarkNet getLatestBlock NOT YET IMPLEMENTED for ${this.config.chainName}. Returning 0.`,
    );
    // TODO: Implement logic to get the latest StarkNet block number
    // Example: const block = await this.starknetProvider.getBlock('latest'); return block.block_number;
    return 0; // Placeholder
  }

  async checkForPastDeposits(_options: {
    pastTimeInMinutes: number;
    latestBlock: number; // Represents block number
  }): Promise<void> {
    if (this.config.useEndpoint) return;
    logger.warn(`StarkNet checkForPastDeposits NOT YET IMPLEMENTED for ${this.config.chainName}.`);
    // TODO: Implement logic to query past StarkNet events
    // Example: await this.starknetProvider.getEvents({ from_block: { block_number: startBlock }, to_block: { block_number: endBlock }, address: contractAddress, keys: ['EVENT_SELECTOR'] });
    // Need to map pastTimeInMinutes to block numbers.
  }

  public async finalizeDeposit(deposit: Deposit): Promise<void> {
    logger.info(
      `Attempting to finalize deposit for StarkNet via L1 StarkGate contract | ID: ${deposit.id} | Chain: ${this.config.chainName}`,
    );
    // TODO: Integrate logDepositAttempt(deposit.id, 'finalizeDeposit', `StarkNet L1 Finalize Attempt`);

    if (!this.starkGateContract) {
      const errMsg = `StarkGate L1 contract (signer instance) not available for ${this.config.chainName}. Cannot finalize deposit ${deposit.id}.`;
      logger.error(errMsg);
      // TODO: Integrate logDepositError(deposit.id, 'finalizeDeposit', 'StarkGate L1 contract not available.');
      throw new Error(errMsg);
    }

    if (deposit.status !== DepositStatus.INITIALIZED) {
      logger.warn(
        `FinalizeDeposit for ${this.config.chainName} | Deposit ${deposit.id} is not in INITIALIZED status (current: ${deposit.status}). Skipping finalization.`,
      );
      // TODO: Integrate logDepositInfo(deposit.id, `Finalize attempt skipped, status not INITIALIZED: ${deposit.status}`);
      return;
    }

    const depositKey = deposit.id; // Assuming deposit.id is the bytes32 depositKey

    try {
      logger.debug(
        `Quoting L1->L2 message fee for deposit ${deposit.id} on ${this.config.chainName}`,
      );
      const messageFee = await this.starkGateContract.quoteFinalizeDeposit();
      logger.info(
        `Quoted L1->L2 message fee for deposit ${deposit.id} on ${this.config.chainName}: ${ethers.utils.formatEther(messageFee)} ETH`,
      );

      // Optional: Add a buffer, e.g., 10% -> messageFee.mul(110).div(100);
      // For now, using the direct quote.

      const txOverrides = {
        value: messageFee,
        // gasLimit: ethers.utils.hexlify(YOUR_GAS_LIMIT) // Optional: if specific gas limit needed
      };

      logger.info(
        `Calling L1 StarkGate.finalizeDeposit for deposit ${deposit.id} on ${this.config.chainName} with fee ${ethers.utils.formatEther(messageFee)} ETH`,
      );

      try {
        await this.starkGateContract.callStatic.finalizeDeposit(depositKey, txOverrides);
        logger.debug(
          `L1 StarkGate.finalizeDeposit callStatic check passed for deposit ${deposit.id} on ${this.config.chainName}`,
        );
      } catch (callStaticError: any) {
        logger.error(
          `L1 StarkGate.finalizeDeposit callStatic check FAILED for deposit ${deposit.id} on ${this.config.chainName}: ${callStaticError.message}`,
          callStaticError,
        );
        // TODO: Integrate logDepositError(deposit.id, 'finalizeDeposit', `L1 finalizeDeposit callStatic failed: ${callStaticError.message}`);
        // Proceeding with actual transaction attempt despite callStatic failure, as it might provide more info or succeed.
      }

      const txResponse = await this.starkGateContract.finalizeDeposit(depositKey, txOverrides);
      logger.info(
        `L1 StarkGate.finalizeDeposit transaction submitted for deposit ${deposit.id} on ${this.config.chainName}. TxHash: ${txResponse.hash}`,
      );

      deposit.hashes.eth.finalizeTxHash = txResponse.hash;
      deposit.status = DepositStatus.FINALIZING;
      deposit.statusMessage = 'L1 Finalize Tx Sent';
      deposit.dates.finalizationAt = Math.floor(Date.now() / 1000);
      deposit.dates.lastActivityAt = Math.floor(Date.now() / 1000);
      await DepositStore.update(deposit);
      // TODO: Integrate logDepositInfo(deposit.id, `L1 StarkGate.finalizeDeposit tx submitted: ${txResponse.hash}. Status: FINALIZING.`);

      logger.info(
        `Waiting for ${this.config.l1Confirmations} L1 confirmation(s) for StarkGate.finalizeDeposit tx ${txResponse.hash} (deposit ${deposit.id})`,
      );
      const receipt = await txResponse.wait(this.config.l1Confirmations);

      if (receipt.status === 1) {
        logger.info(
          `L1 StarkGate.finalizeDeposit transaction CONFIRMED for deposit ${deposit.id}. TxHash: ${receipt.transactionHash}, Block: ${receipt.blockNumber}`,
        );
        deposit.status = DepositStatus.FINALIZED;
        deposit.statusMessage = 'L1 Finalize Tx Confirmed';
        deposit.dates.lastActivityAt = Math.floor(Date.now() / 1000);
        await DepositStore.update(deposit);
        // TODO: Integrate logDepositInfo(deposit.id, `L1 StarkGate.finalizeDeposit tx confirmed: ${receipt.transactionHash}. Status: FINALIZED. Awaiting TBTCBridgedToStarkNet event.`);
      } else {
        logger.error(
          `L1 StarkGate.finalizeDeposit transaction REVERTED for deposit ${deposit.id}. TxHash: ${receipt.transactionHash}, Block: ${receipt.blockNumber}`,
        );
        // TODO: Integrate logDepositError(deposit.id, 'finalizeDeposit', `L1 finalizeDeposit tx reverted: ${receipt.transactionHash}`);
        deposit.status = DepositStatus.INITIALIZED; // Revert status to allow retry or manual intervention
        deposit.error = `L1 finalizeDeposit tx reverted: ${receipt.transactionHash}`;
        deposit.dates.lastActivityAt = Math.floor(Date.now() / 1000);
        await DepositStore.update(deposit);
        throw new Error(
          `L1 StarkGate.finalizeDeposit transaction reverted for deposit ${deposit.id}. TxHash: ${receipt.transactionHash}`,
        );
      }
    } catch (error: any) {
      logger.error(
        `Error during L1 StarkGate.finalizeDeposit for deposit ${deposit.id} on ${this.config.chainName}: ${error.message}`,
        error,
      );
      // TODO: Integrate logDepositError(deposit.id, 'finalizeDeposit', `Error: ${error.message}`);
      deposit.error = `Error during L1 finalizeDeposit: ${error.message}`;
      deposit.dates.lastActivityAt = Math.floor(Date.now() / 1000);
      // Avoid reverting status here unless it's a non-retryable error or if the deposit was not yet marked FINALIZED.
      // If tx was submitted and then wait failed, status might be FINALIZED. If submission failed, it's still INITIALIZED.
      await DepositStore.update(deposit).catch((storeError) => {
        logger.error(
          `Failed to update deposit ${deposit.id} with error state after finalizeDeposit failure: ${storeError.message}`,
          storeError,
        );
      });
      throw error; // Re-throw for external retry mechanisms
    }
  }

  // Override supportsPastDepositCheck if StarkNet L2 checks are possible
  // supportsPastDepositCheck(): boolean {
  //     // StarkNet event querying might be complex/limited, evaluate feasibility
  //     const supports = !!(this.config.l2Rpc && !this.config.useEndpoint);
  //     return supports;
  // }

  private async createDeposit(
    fundingTx: Buffer,
    reveal: Reveal,
    outputIndex: number,
    l2RecipientStarkNetAddress: string,
  ): Promise<Deposit> {
    const fundingTxHash = getFundingTxHash(fundingTx);
    const depositId = getDepositId(fundingTxHash, reveal.outputIndex); // Use reveal.outputIndex for consistency with how it's likely derived

    // Log and ensure that the l2RecipientStarkNetAddress is a valid StarkNet address string before creating the deposit object.
    // The actual validation (is it a felt, etc.) should happen before this method is called (e.g., in initializeDeposit).
    logger.info(
      `Creating deposit entry for ID: ${depositId}, StarkNet Recipient: ${l2RecipientStarkNetAddress}`,
    );

    // Create the deposit object using the utility
    // Note: The `createDepositUtil` expects reveal data to be structured. We need to ensure the `reveal` object
    // passed here aligns with what `createDepositUtil` expects or adjust the call.
    // For now, assuming `reveal` object contains necessary fields like `lockingScript`, `outputIndex`, `fundingTransaction` etc.
    // The recipient for StarkNet is the StarkNet address itself.
    const deposit = createDepositUtil(
      {
        // Constructing FundingTransaction type expected by createDepositUtil
        // This needs to match the structure of `FundingTransaction` type. Example:
        transaction: fundingTx, // The raw transaction buffer
        outputIndex: reveal.outputIndex, // The specific output index from the reveal data
        // Other fields from FundingTransaction type might be needed if createDepositUtil expects them
        // For example, if it needs parsed transaction details, we might need to parse fundingTx here.
        // Based on EVMChainHandler, it seems to pass a more structured fundingTx object.
        // Let's assume fundingTx is Buffer and reveal contains necessary details like outputIndex and the full fundingTransaction details if needed by createDepositUtil.
      },
      reveal, // Pass the full reveal object
      l2RecipientStarkNetAddress, // l2Owner for StarkNet is the StarkNet address
      this.config.l1SenderAddress || 'StarkNetRelayer', // l2Sender - who is initiating this on L2 (relayer)
      this.config.chainName,
      this.config.chainId,
      this.config.chainType,
      // Add StarkNet specific data if any to be stored at creation
    );

    // Store the newly created deposit
    await DepositStore.create(deposit);
    logDepositInfo(deposit.id, 'StarkNet deposit created in QUEUED state.');
    return deposit;
  }

  /**
   * Initializes a deposit on the L1 StarkGate contract.
   * This involves validating the StarkNet address, formatting it for the contract,
   * and calling the `initializeDeposit` method on the L1 contract.
   *
   * @param fundingTx The raw Bitcoin funding transaction.
   * @param reveal The reveal data containing the StarkNet recipient address.
   * @param outputIndex The output index of the funding transaction.
   * @returns A Promise that resolves when the deposit is successfully initialized on L1.
   */
  public async initializeDeposit(
    fundingTx: Buffer, // Raw Bitcoin transaction
    reveal: Reveal, // Reveal data containing locking script, output index, etc.
    _outputIndex: number, // outputIndex is part of reveal, but kept for interface consistency if needed
  ): Promise<Deposit> {
    const fundingTxHash = getFundingTxHash(fundingTx);
    // Deposit ID is typically derived from fundingTxHash and outputIndex from reveal
    const tempDepositId = getDepositId(fundingTxHash, reveal.outputIndex);
    logDepositInfo(
      tempDepositId,
      `Starting initializeDeposit for StarkNet. Funding Tx Hash: ${fundingTxHash}, Output Index: ${reveal.outputIndex}`,
    );

    let starkNetAddress: string;
    try {
      starkNetAddress = extractAddressFromBitcoinScript(
        reveal.lockingScript,
        this.config.network, // 'mainnet' or 'testnet' for P2(W)SH version bytes
      );
      if (!validateStarkNetAddress(starkNetAddress)) {
        throw new Error(`Invalid StarkNet address extracted: ${starkNetAddress}`);
      }
      logDepositInfo(tempDepositId, `Extracted StarkNet address: ${starkNetAddress}`);
    } catch (error: any) {
      logDepositError(
        tempDepositId,
        `Failed to extract/validate StarkNet address from Bitcoin script: ${error.message}`,
        error,
      );
      // Cannot proceed without a valid StarkNet address
      // Create a temporary deposit object for error logging if one doesn't exist or update if it does.
      // For now, we will re-throw, assuming the caller or a higher level handles deposit state for such early failures.
      throw error; // Or update a preliminary deposit record to ERROR state.
    }

    // Create and store the initial deposit object in QUEUED state
    // This utility should handle the deposit ID generation internally.
    let deposit = await this.createDeposit(
      fundingTx,
      reveal,
      reveal.outputIndex,
      starkNetAddress,
    );

    try {
      if (!this.starkGateContract) {
        throw new Error(
          'StarkGate L1 contract (starkGateContract with signer) is not initialized. Cannot send initializeDeposit transaction.',
        );
      }

      const starkNetRecipientBytes32 = formatStarkNetAddressForContract(starkNetAddress);
      logDepositInfo(
        deposit.id,
        `Formatted StarkNet address for L1 contract: ${starkNetRecipientBytes32}`,
      );

      // Prepare arguments for the L1 StarkGate contract's initializeDeposit method
      // The contract expects: initializeDeposit(FundingTransaction calldata fundingTx, Reveal calldata reveal, bytes32 l2DepositOwner)
      // We need to map our `fundingTx` (Buffer) and `reveal` (Reveal type) to these structures.

      // Constructing the FundingTransaction struct for the contract call:
      // This requires parsing the `fundingTx` Buffer or using fields from `reveal.fundingTransaction`
      // For `ethers.js` contract calls, complex objects are passed as arrays or JS objects matching struct fields.
      const contractFundingTx: FundingTransaction = {
        // Assuming reveal.fundingTransaction contains the full, potentially parsed, tx data
        // This is based on `Reveal` type containing `fundingTransaction: TxWithInputOutput;`
        transaction: reveal.fundingTransaction.transaction, // This should be the hex string of the tx
        outputIndex: reveal.fundingTransaction.outputIndex,
        // Ensure all fields of the Solidity struct FundingTransaction are present
        // Example: value, script, etc. might be needed depending on struct definition
        // For StarkGate, it's likely simpler: transaction bytes, output index
        // We must align this with the *actual* Solidity struct for `FundingTransaction` in `IStarkGateBridge.sol`
        // For now, let's assume a simplified version or that the ABI coder handles it.
        // From contract: struct FundingTransaction { bytes transaction; uint256 outputIndex; }
        // So, we need the transaction as bytes (hex string) and outputIndex.
        // The `fundingTx` Buffer needs to be hex-encoded: `0x${fundingTx.toString('hex')}`
      };
      // Corrected mapping for contract call:
      const l1ContractFundingTxArg = {
        transaction: `0x${fundingTx.toString('hex')}`,
        outputIndex: reveal.outputIndex, // This is the outputIndex being claimed in the fundingTx
      };

      // The `reveal` parameter is of type `Reveal` from `types/Reveal.type.ts`,
      // which is `[number, string, string, string, string, string] تع RevealTuple`.
      // We need to map this tuple to the fields of the Solidity `RevealData` struct.
      // Assuming the tuple elements correspond to:
      // reveal[0]: version (e.g., Bitcoin script version)
      // reveal[1]: parentTransaction (bytes of the tx whose output is spent by fundingTx's input)
      // reveal[2]: inputIndex (index of input in fundingTx that spends parentTransaction's output)
      // reveal[3]: outputIndex (index of output in parentTransaction spent by fundingTx's input)
      // reveal[4]: lockingScript (scriptPubKey of the output in parentTransaction)
      // reveal[5]: value (value of the output in parentTransaction)
      // This mapping MUST be confirmed against the actual Solidity struct definition for RevealData.
      const revealTuple = reveal; // aliasing for clarity if Reveal type is complex

      const l1ContractRevealArg = {
        version: revealTuple[0], // Assuming number, cast if necessary for BigNumberish
        parentTransaction: revealTuple[1], // Assuming hex string, should be `0x` prefixed if not already
        inputIndex: revealTuple[2], // Assuming number
        outputIndex: revealTuple[3], // Assuming number (this is the UTXO's index in its original tx)
        lockingScript: revealTuple[4], // Assuming hex string (scriptPubKey)
        value: revealTuple[5], // Assuming string representing number, or number. Ethers handles BigNumberish.
      };

      // Pre-flight check using callStatic
      logDepositInfo(deposit.id, 'Simulating initializeDeposit transaction (callStatic)...');
      try {
        await this.starkGateContract.callStatic.initializeDeposit(
          l1ContractFundingTxArg,
          l1ContractRevealArg, // This argument structure needs to be confirmed with the actual ABI
          starkNetRecipientBytes32,
        );
        logDepositInfo(deposit.id, 'initializeDeposit simulation successful.');
      } catch (callStaticError: any) {
        const errMsg = `initializeDeposit simulation failed (callStatic): ${callStaticError.message}`;
        logDepositError(deposit.id, errMsg, callStaticError);
        deposit = await DepositStore.update(deposit.id, {
          status: DepositStatus.ERROR,
          statusMessage: `L1 Init Sim Failed: ${callStaticError.reason || callStaticError.message}`.substring(0, 255),
        });
        throw new Error(errMsg); // Re-throw to halt processing
      }

      // Execute the transaction
      logDepositInfo(deposit.id, 'Sending initializeDeposit transaction to L1 StarkGate contract...');
      const txResponse = await this.starkGateContract.initializeDeposit(
        l1ContractFundingTxArg,
        l1ContractRevealArg, // Ensure this structure is correct for the ABI
        starkNetRecipientBytes32,
        {
          // Add gas estimation/limits if necessary, or let ethers handle it
          // gasLimit: this.config.l1GasLimit?.initializeDeposit, // Example
        },
      );

      logDepositInfo(
        deposit.id,
        `initializeDeposit transaction sent. Tx Hash: ${txResponse.hash}`,
      );
      deposit = await DepositStore.update(deposit.id, {
        status: DepositStatus.INITIALIZING,
        statusMessage: 'L1 Init Tx Sent',
        l1InitializeTxHash: txResponse.hash,
      });

      // Wait for confirmations
      const confirmations = this.config.l1Confirmations || 1;
      logDepositInfo(
        deposit.id,
        `Waiting for ${confirmations} confirmations for L1 initializeDeposit transaction...`,
      );
      await txResponse.wait(confirmations);

      logDepositInfo(
        deposit.id,
        `L1 initializeDeposit transaction confirmed. Tx Hash: ${txResponse.hash}`,
      );
      deposit = await DepositStore.update(deposit.id, {
        status: DepositStatus.INITIALIZED,
        statusMessage: 'L1 Init Confirmed',
      });

      return deposit;
    } catch (error: any) {
      const errorMessage = `Error during StarkNet initializeDeposit L1 transaction for deposit ${deposit.id}: ${error.message}`;
      logDepositError(deposit.id, errorMessage, error);
      await DepositStore.update(deposit.id, {
        status: DepositStatus.ERROR,
        statusMessage: `L1 Init Error: ${error.reason || error.message}`.substring(0, 255),
      });
      // Re-throw the error to be handled by the caller (e.g., EndpointController)
      throw new Error(errorMessage, { cause: error });
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

    const depositKeyUint256 = ethers.BigNumber.from(deposit.id); // The event uses uint256 for depositKey

    try {
      logger.debug(
        `hasDepositBeenMintedOnTBTC | Checking for OptimisticMintingFinalized event for depositKey ${deposit.id} (uint256: ${depositKeyUint256.toString()}) on chain ${this.config.chainName}`, 
      );

      // Determine a safe start block for querying.
      // Using l1InitializeTxHash block number if available, otherwise fallback to a wider range or config.
      let fromBlock: number | undefined = undefined;
      if (deposit.l1InitializeTxHash) {
        try {
          const txReceipt = await this.l1Provider.getTransactionReceipt(deposit.l1InitializeTxHash);
          if (txReceipt) {
            fromBlock = txReceipt.blockNumber - 10; // A small buffer before the init tx block
          }
        } catch (receiptError: any) {
          logger.warn(`hasDepositBeenMintedOnTBTC | Error fetching receipt for l1InitializeTxHash ${deposit.l1InitializeTxHash} to determine fromBlock: ${receiptError.message}`);
        }
      }
      if (!fromBlock) {
        // Fallback: use l2StartBlock from config, or a recent range if that's too old.
        // For simplicity here, using a configured lookback window or chain start block if more specific logic is too complex.
        // For now, let's default to the chain's configured l2StartBlock if no tx-specific block is found.
        // This might scan a large range if l2StartBlock is very old.
        // A better fallback might be `currentBlock - X_BLOCKS`.
        fromBlock = this.config.l2StartBlock > 0 ? this.config.l2StartBlock : 'earliest';
        logger.debug(`hasDepositBeenMintedOnTBTC | Falling back to fromBlock: ${fromBlock} for deposit ${deposit.id}`);
      }

      const events = await this.tbtcVaultProvider.queryFilter(
        // The filter matches by the indexed depositKey argument
        this.tbtcVaultProvider.filters.OptimisticMintingFinalized(null, depositKeyUint256),
        fromBlock,
        'latest'
      );

      if (events.length > 0) {
        logger.info(
          `hasDepositBeenMintedOnTBTC | Found OptimisticMintingFinalized event for deposit ${deposit.id}. Assuming minting confirmed.`,
        );
        return true;
      }
      logger.debug(
        `hasDepositBeenMintedOnTBTC | No OptimisticMintingFinalized event found for deposit ${deposit.id} in scanned range.`, 
      );
      return false;
    } catch (error: any) {
      logger.error(
        `hasDepositBeenMintedOnTBTC | Error querying OptimisticMintingFinalized events for deposit ${deposit.id}: ${error.message}`,
        error,
      );
      return false; // Assume not minted on error to be safe
    }
  }

  /**
   * Processes deposits that are in the INITIALIZED state to check if their
   * corresponding tBTC minting has been finalized. If so, triggers L1 finalization on StarkGate.
   * This acts as a recovery mechanism if the live OptimisticMintingFinalized event was missed.
   */
  public async processMintedDepositsForFinalization(): Promise<void> {
    logger.info(`StarknetChainHandler | Running processMintedDepositsForFinalization for ${this.config.chainName}`);
    const depositsToProcess = await DepositStore.getByStatus(
      DepositStatus.INITIALIZED,
      this.config.chainId,
    );

    if (depositsToProcess.length === 0) {
      logger.debug(`StarknetChainHandler | No deposits in INITIALIZED state found for ${this.config.chainName} to process for finalization.`);
      return;
    }

    logger.info(
      `StarknetChainHandler | Found ${depositsToProcess.length} deposits in INITIALIZED state for ${this.config.chainName} to check for tBTC minting.`, 
    );

    for (const deposit of depositsToProcess) {
      try {
        // Add a delay or check deposit age to avoid processing too rapidly after initialization
        const ageInMs = Date.now() - (deposit.dates.initializationAt || 0);
        // e.g., wait at least 5 minutes before checking, to give live event listener a chance.
        if (ageInMs < (this.config.processingDelayMinutes?.mintCheck || 5) * 60 * 1000) { 
          logger.debug(`StarknetChainHandler | Deposit ${deposit.id} is too recent (${(ageInMs/1000/60).toFixed(1)} min old). Skipping mint check for now.`);
          continue;
        }

        logger.info(
          `StarknetChainHandler | Checking tBTC minting status for INITIALIZED deposit ${deposit.id}`,
        );
        const isMinted = await this.hasDepositBeenMintedOnTBTC(deposit);

        if (isMinted) {
          logger.info(
            `StarknetChainHandler | tBTC minting confirmed for deposit ${deposit.id}. Attempting to finalize on StarkGate.`, 
          );
          // Update status to reflect minting confirmed before calling finalize (optional)
          // deposit.status = DepositStatus.MINT_CONFIRMED; // Example, if such a status is added
          // await DepositStore.update(deposit);
          await this.finalizeDeposit(deposit); // finalizeDeposit handles its own status updates (FINALIZING -> FINALIZED)
        } else {
          logger.debug(
            `StarknetChainHandler | tBTC minting not yet confirmed for deposit ${deposit.id}. Will re-check later.`, 
          );
        }
      } catch (error: any) {
        logger.error(
          `StarknetChainHandler | Error processing deposit ${deposit.id} for finalization: ${error.message}`,
          error,
        );
        // Optionally update deposit with error, or rely on next retry cycle
        deposit.error = `Error in processMintedDepositsForFinalization: ${error.message}`.substring(0,255);
        deposit.dates.lastActivityAt = Date.now();
        await DepositStore.update(deposit).catch(updErr => logger.error(`Failed to update deposit ${deposit.id} with error: ${updErr.message}`));
      }
    }
    logger.info(`StarknetChainHandler | Finished processMintedDepositsForFinalization for ${this.config.chainName}`);
  }
}
