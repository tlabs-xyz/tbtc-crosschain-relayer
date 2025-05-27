import { CHAIN_TYPE } from '../config/schemas/common.schema.js';
import type { StarknetChainConfig } from '../config/schemas/starknet.chain.schema.js';
import { StarknetChainConfigSchema } from '../config/schemas/starknet.chain.schema.js';
import logger from '../utils/Logger.js';
import { BaseChainHandler } from './BaseChainHandler.js';
import { ethers } from 'ethers'; // Ethers import for Contract
import type { IStarkGateBridge, EthersStarkGateBridge } from '../interfaces/IStarkGateBridge.js'; // IStarkGateBridge type
import { IStarkGateBridgeABI } from '../interfaces/IStarkGateBridge.abi.js'; // The ABI we just created

// Custom type imports for Deposit processing
import { DepositStore } from '../utils/DepositStore.js';
import { DepositStatus } from '../types/DepositStatus.enum.js'; // Corrected path
// import { logDepositError, logDepositInfo } from '../utils/AuditLog.js'; // Uncomment when AuditLog is confirmed

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
      deposit.status = DepositStatus.FINALIZED;
      deposit.dates.finalizationAt = Math.floor(Date.now() / 1000);
      deposit.dates.lastActivityAt = Math.floor(Date.now() / 1000);
      await DepositStore.update(deposit);
      // TODO: Integrate logDepositInfo(deposit.id, `L1 StarkGate.finalizeDeposit tx submitted: ${txResponse.hash}. Status: FINALIZED.`);

      logger.info(
        `Waiting for ${this.config.l1Confirmations} L1 confirmation(s) for StarkGate.finalizeDeposit tx ${txResponse.hash} (deposit ${deposit.id})`,
      );
      const receipt = await txResponse.wait(this.config.l1Confirmations);

      if (receipt.status === 1) {
        logger.info(
          `L1 StarkGate.finalizeDeposit transaction CONFIRMED for deposit ${deposit.id}. TxHash: ${receipt.transactionHash}, Block: ${receipt.blockNumber}`,
        );
        // TODO: Integrate logDepositInfo(deposit.id, `L1 StarkGate.finalizeDeposit tx confirmed: ${receipt.transactionHash}. Awaiting TBTCBridgedToStarkNet event.`);
        // Deposit is FINALIZED. The TBTCBridgedToStarkNet event listener (from T2.2) will move it to BRIDGED.
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
}
