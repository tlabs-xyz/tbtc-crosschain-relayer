import { CHAIN_TYPE } from '../config/schemas/common.schema.js';
import type { StarknetChainConfig } from '../config/schemas/starknet.chain.schema.js';
import { StarknetChainConfigSchema } from '../config/schemas/starknet.chain.schema.js';
import logger from '../utils/Logger.js';
import { BaseChainHandler } from './BaseChainHandler.js';
import { type Overrides, ethers } from 'ethers'; // Reverted Overrides to type import
import type { EthersStarkGateBridge } from '../interfaces/IStarkGateBridge.js'; // IStarkGateBridge type
import { IStarkGateBridgeABI } from '../interfaces/IStarkGateBridge.abi.js'; // The ABI we just created

// Custom type imports for Deposit processing
import { DepositStore } from '../utils/DepositStore.js';
import { DepositStatus } from '../types/DepositStatus.enum.js'; // Corrected path
// import { logDepositError, logDepositInfo } from '../utils/AuditLog.js'; // Uncomment when AuditLog is confirmed
import {
  validateStarkNetAddress,
  formatStarkNetAddressForContract,
} from '../utils/starknetAddress.js'; // Address utilities
import type { Deposit } from '../types/Deposit.type.js'; // Deposit type
import type { Reveal } from '../types/Reveal.type.js'; // Reveal type
import { getFundingTxHash } from '../utils/GetTransactionHash.js'; // To get fundingTxHash
import {
  getDepositId,
  updateToInitializedDeposit,
  updateToFinalizedDeposit,
} from '../utils/Deposits.js'; // Renamed to avoid conflict
import { logDepositError, logStatusChange } from '../utils/AuditLog.js'; // Removed logDepositInfo
import { logErrorContext } from '../utils/Logger.js'; // Separated import for logErrorContext
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
      logger.info(`StarknetChainHandler constructed and validated for ${this.config.chainName}`);
    } catch (error: any) {
      // Log the detailed Zod validation error
      logger.error(
        `Invalid StarkNet configuration for ${config.chainName}: ${error.message}`,
        { zodErrors: error.errors }, // Include Zod error details for better debugging
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

    logger.info(`L1 TBTCBridgedToStarkNet event listener is active for ${this.config.chainName}`);

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
      if (deposit.chainId !== this.config.chainName) {
        logger.error(
          `${logPrefix} Mismatched chain for DepositKey ${depositId} (Deposit Chain: ${deposit.chainId}) processed by handler for Chain: ${this.config.chainName}. This indicates an issue with event routing or deposit ID uniqueness. Skipping update.`,
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
    const depositId = getDepositId(
      getFundingTxHash(deposit.L1OutputEvent.fundingTx),
      deposit.L1OutputEvent.reveal[0], // Assuming fundingOutputIndex is the first element
    );
    const logPrefix = `FINALIZE_DEPOSIT ${this.config.chainName} ${depositId} |`;

    logger.info(`${logPrefix} Attempting to finalize deposit.`);

    if (!this.starkGateContract) {
      logger.error(
        `${logPrefix} StarkGate L1 contract (signer) instance not available. Cannot finalize deposit.`,
      );
      logErrorContext(
        `${logPrefix} StarkGate L1 contract (signer) not available`,
        new Error('StarkGate L1 contract (signer) not available'),
      );
      await logDepositError(
        deposit.id,
        'StarkGate L1 contract (signer) instance not available for finalization.',
        { internalError: 'StarkGate L1 contract (signer) not available' },
      );
      return undefined;
    }

    // Ensure the deposit has an L2 transaction hash from StarkNet
    // This would typically be set by an L2 monitor or an off-chain process confirming the L2 mint.
    if (!deposit.hashes.starknet?.l2TxHash) {
      logger.warn(
        `${logPrefix} Deposit does not have an L2 transaction hash (starknet.l2TxHash). Cannot finalize.`,
      );
      await logDepositError(deposit.id, 'Deposit missing L2 transaction hash for finalization.', {
        currentStatus: deposit.status,
      });
      return undefined;
    }

    // Construct the arguments for StarkGate's finalizeDeposit
    // This depends on the exact signature of your StarkGate contract's finalizeDeposit method.
    // Typically, it might require the L2 transaction hash or other identifiers.
    // For this example, let's assume it takes the l2TxHash and amount (as felt).
    // The amount might need to be converted to a format StarkNet expects (e.g., felt).
    // This is a placeholder; replace with actual contract arguments.
    const l2TransactionHash = deposit.hashes.starknet.l2TxHash;
    // const amountAsFelt = ethers.BigNumber.from(deposit.L1OutputEvent.fundingTx.amount).toString(); // Example

    try {
      logger.info(
        `${logPrefix} Calling StarkGate L1 contract finalizeDeposit with L2 Tx Hash: ${l2TransactionHash}.`,
      );
      // Replace with actual arguments and overrides
      const txResponse = await this.starkGateContract.finalizeDeposit(
        l2TransactionHash, // This is an example argument
        // amountAsFelt, // This is an example argument
        // txOverrides // Optional
      );

      logger.info(
        `${logPrefix} L1 finalizeDeposit transaction sent. TxHash: ${txResponse.hash}. Waiting for confirmations...`,
      );

      const txReceipt = await txResponse.wait(this.config.l1Confirmations);

      if (txReceipt.status === 1) {
        logger.info(
          `${logPrefix} L1 finalizeDeposit transaction successful. TxHash: ${txReceipt.transactionHash}, Block: ${txReceipt.blockNumber}.`,
        );
        await updateToFinalizedDeposit(deposit, txReceipt);
        // logDepositFinalized(deposit); // Assuming this function exists and is imported
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
    } catch (error: any) {
      logger.error(`${logPrefix} Error during L1 finalizeDeposit: ${error.message}`);
      logErrorContext(`${logPrefix} Error during L1 finalizeDeposit: ${error.message}`, error);
      await logDepositError(deposit.id, `Error during L1 finalizeDeposit: ${error.message}`, error);
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
    const fundingTxHash = getFundingTxHash(deposit.L1OutputEvent.fundingTx);
    const depositId = getDepositId(
      fundingTxHash,
      deposit.L1OutputEvent.reveal[0], // fundingOutputIndex from Reveal array
    );
    const logPrefix = `INITIALIZE_DEPOSIT ${this.config.chainName} ${depositId} |`;

    logger.info(`${logPrefix} Attempting to initialize deposit.`);

    if (!this.starkGateContract) {
      logger.error(
        `${logPrefix} StarkGate L1 contract (signer) instance not available. Cannot initialize deposit.`,
      );
      logErrorContext(
        `${logPrefix} StarkGate L1 contract (signer) not available`,
        new Error('StarkGate L1 contract (signer) not available'),
      );
      await logDepositError(
        deposit.id ?? depositId,
        'StarkGate L1 contract (signer) instance not available for initialization.',
        { internalError: 'StarkGate L1 contract (signer) not available' },
      );
      return undefined;
    }

    // Prepare L1 transaction arguments
    const fundingTx: FundingTransaction = deposit.L1OutputEvent.fundingTx;
    const revealData: Reveal = deposit.L1OutputEvent.reveal; // This is [fundingOutputIndex, blindingFactor, walletPubKeyHash, refundPubKeyHash, refundLocktime]
    const l2DepositOwner: string = deposit.L1OutputEvent.l2DepositOwner; // StarkNet recipient address

    // Validate and format StarkNet recipient address
    if (!validateStarkNetAddress(l2DepositOwner)) {
      logger.error(`${logPrefix} Invalid StarkNet recipient address: ${l2DepositOwner}`);
      await logDepositError(deposit.id ?? depositId, 'Invalid StarkNet recipient address.', {
        address: l2DepositOwner,
      });
      return undefined;
    }
    const formattedL2DepositOwner = formatStarkNetAddressForContract(l2DepositOwner);

    // The StarkGate.initializeDeposit function expects:
    // FundingTransaction calldata _fundingTx,
    // bytes[5] calldata _reveal, (bytes32 in Solidity for each element)
    // bytes32 _depositOwner (StarkNet recipient as bytes32 felt)
    // Overrides including msg.value

    const txOverrides: Overrides = {
      value: ethers.BigNumber.from(this.config.l1FeeAmountWei),
    } as any; // Keep cast for Overrides object due to persistent TS issue

    try {
      logger.info(
        `${logPrefix} Calling StarkGate L1 contract initializeDeposit for StarkNet recipient: ${formattedL2DepositOwner} (original: ${l2DepositOwner}) with fee: ${(txOverrides as any).value.toString()}`,
      );
      logger.debug(`${logPrefix} L1 Contract Funding Tx Arg:`, fundingTx);
      logger.debug(`${logPrefix} L1 Contract Reveal Arg:`, revealData);

      const txResponse = await this.starkGateContract.initializeDeposit(
        [
          fundingTx.version,
          fundingTx.inputVector,
          fundingTx.outputVector,
          fundingTx.locktime,
        ] as any, // Pass as array/tuple, cast to any
        revealData.slice(0, 5) as any, // Cast to any to bypass TS type check for bytes[5]
        formattedL2DepositOwner,
        txOverrides,
      );

      logger.info(
        `${logPrefix} L1 initializeDeposit transaction sent. TxHash: ${txResponse.hash}. Waiting for confirmations...`,
      );
      deposit.hashes.eth.initializeTxHash = txResponse.hash; // Store optimistic hash

      // Note: Original code had DepositStatus.PENDING_L1_INIT_CONFIRMATION
      // Reverting to QUEUED or INITIALIZED based on outcome.
      // If this status was crucial, it needs to be re-added to DepositStatus.enum.ts
      // For now, we'll update to INITIALIZED upon successful confirmation.

      const txReceipt = await txResponse.wait(this.config.l1Confirmations);

      if (txReceipt.status === 1) {
        logger.info(
          `${logPrefix} L1 initializeDeposit transaction successful. TxHash: ${txReceipt.transactionHash}, Block: ${txReceipt.blockNumber}.`,
        );
        await updateToInitializedDeposit(deposit, txReceipt); // Corrected: pass full deposit object
        // logDepositInitialized(deposit); // Assuming this function exists and is imported
        return txReceipt;
      } else {
        // Transaction failed/reverted
        const revertMsg = `${logPrefix} L1 initializeDeposit transaction reverted. TxHash: ${txReceipt.transactionHash}, Block: ${txReceipt.blockNumber}.`;
        logger.error(revertMsg);
        logErrorContext(revertMsg, { receipt: txReceipt });
        await logDepositError(
          deposit.id ?? depositId,
          `L1 initializeDeposit tx reverted: ${txReceipt.transactionHash}`,
          { receipt: txReceipt },
        );
        // Consider if status should be reverted or set to an error state
        deposit.status = DepositStatus.QUEUED; // Revert to QUEUED to allow reprocessing
        logStatusChange(deposit, DepositStatus.QUEUED, DepositStatus.INITIALIZED); // Assuming it was optimistically INITIALIZED or similar before this point
        await DepositStore.update(deposit); // Persist status change
        return undefined;
      }
    } catch (error: any) {
      // Error during the call itself or waiting for receipt
      logger.error(`${logPrefix} Error during L1 initializeDeposit: ${error.message}`);
      logErrorContext(`${logPrefix} Error during L1 initializeDeposit: ${error.message}`, error);

      await logDepositError(
        deposit.id ?? depositId,
        `Error during L1 initializeDeposit: ${error.message}`,
        error,
      );
      // Consider if status should be reverted or set to an error state
      // deposit.status = DepositStatus.ERROR_L1_INITIATION; // Example error status
      // await DepositStore.update(deposit);
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

    const depositKeyUint256 = ethers.BigNumber.from(deposit.id); // The event uses uint256 for depositKey

    try {
      logger.debug(
        `hasDepositBeenMintedOnTBTC | Checking for OptimisticMintingFinalized event for depositKey ${deposit.id} (uint256: ${depositKeyUint256.toString()}) on chain ${this.config.chainName}`,
      );

      // Using l1InitializeTxHash block number if available, otherwise fallback to a wider range or config.
      let fromBlock: number | undefined = undefined;
      if (deposit.hashes.eth.initializeTxHash) {
        try {
          const txReceipt = await this.l1Provider.getTransactionReceipt(
            deposit.hashes.eth.initializeTxHash,
          );
          if (txReceipt) {
            fromBlock = txReceipt.blockNumber - 10; // A small buffer before the init tx block
          }
        } catch (receiptError: any) {
          logger.warn(
            `hasDepositBeenMintedOnTBTC | Error fetching receipt for l1InitializeTxHash ${deposit.hashes.eth.initializeTxHash} to determine fromBlock: ${receiptError.message}`,
          );
        }
      }
      if (!fromBlock) {
        // Fallback to a wider range or config
        fromBlock = this.config.l2StartBlock > 0 ? this.config.l2StartBlock - 10 : undefined;
      }

      if (fromBlock) {
        logger.info(
          `hasDepositBeenMintedOnTBTC | Checking for OptimisticMintingFinalized event for depositKey ${deposit.id} (uint256: ${depositKeyUint256.toString()}) on chain ${this.config.chainName} from block ${fromBlock}`,
        );

        // Query the TBTCVault contract for the OptimisticMintingFinalized event
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
    } catch (error: any) {
      const errorMsg = `Error checking deposit ${deposit.id} minting status on chain ${this.config.chainName}: ${error.message}`;
      logger.error(errorMsg, { error: logErrorContext(errorMsg, error) });
      logDepositError(deposit.id, errorMsg, error);
      return false;
    }
  }
}
