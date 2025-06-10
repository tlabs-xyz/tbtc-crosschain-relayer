import type { StarknetChainConfig } from '../config/schemas/starknet.chain.schema.js';
import { StarknetChainConfigSchema } from '../config/schemas/starknet.chain.schema.js';
import logger, { logErrorContext } from '../utils/Logger.js';
import { BaseChainHandler } from './BaseChainHandler.js';
import { ethers, type PayableOverrides, type BigNumberish, type BytesLike } from 'ethers';
import { StarkNetBitcoinDepositorABI } from '../interfaces/StarkNetBitcoinDepositor.js';
import type { StarkNetBitcoinDepositor } from '../interfaces/IStarkNetBitcoinDepositor.js';
import { DepositStore } from '../utils/DepositStore.js';
import { DepositStatus } from '../types/DepositStatus.enum.js';
import { toUint256StarknetAddress, validateStarkNetAddress } from '../utils/starknetAddress.js';
import type { Deposit } from '../types/Deposit.type.js';
import type { Reveal } from '../types/Reveal.type.js';
import { getFundingTxHash } from '../utils/GetTransactionHash.js';
import {
  getDepositId,
  updateToInitializedDeposit,
  updateToFinalizedDeposit,
  getDepositKey,
  createInitializedDepositFromOnChainData,
  createPartialDepositFromOnChainData,
} from '../utils/Deposits.js';
import { logDepositError, logStatusChange } from '../utils/AuditLog.js';
import type { FundingTransaction } from '../types/FundingTransaction.type.js';

export class StarknetChainHandler extends BaseChainHandler<StarknetChainConfig> {
  // --- L1 StarkGate Contract Instances ---
  /** L1 StarkGate contract instance for sending transactions (uses L1 signer with nonce manager) */
  protected l1DepositorContract: StarkNetBitcoinDepositor;
  /** L1 StarkGate contract instance for read-only operations and event listening (uses L1 provider) */
  protected l1DepositorContractProvider: StarkNetBitcoinDepositor;
  /** L1 StarkGate bridge contract instance for read-only fee estimation */
  protected starkGateBridgeContract: ethers.Contract;

  constructor(config: StarknetChainConfig) {
    super(config);
    try {
      StarknetChainConfigSchema.parse(config);
      logger.info(`StarknetChainHandler constructed and validated for ${this.config.chainName}`);
    } catch (error: any) {
      logger.error(`Invalid StarkNet configuration for ${config.chainName}: ${error.message}`, {
        zodErrors: error.errors,
      });
      // Throw a new error to halt initialization if config is invalid
      throw new Error(
        `Invalid StarkNet configuration for ${config.chainName}. Please check logs for details.`,
      );
    }

    logger.debug(`StarknetChainHandler setup complete for ${this.config.chainName}`);

    try {
      const starkGateBridgeAbi = ['function estimateDepositFeeWei() view returns (uint256)'];
      this.starkGateBridgeContract = new ethers.Contract(
        this.config.starkGateBridgeAddress,
        starkGateBridgeAbi,
        this.l1Provider,
      );
      logger.info(
        `StarkGate Bridge contract provider instance created for ${this.config.chainName} at ${this.config.starkGateBridgeAddress}`,
      );
    } catch (error: any) {
      logger.error(
        `Failed to instantiate StarkGate Bridge contract for ${this.config.chainName}: ${error.message}`,
        error,
      );
    }
  }

  protected async initializeL2(): Promise<void> {
    logger.info(`Initializing StarkNet L1 components for ${this.config.chainName}`);

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
    } catch (error: any) {
      logger.error(
        `Failed to instantiate StarkGate L1 contract instances for ${this.config.chainName}: ${error.message}`,
        error,
      );
      throw new Error(
        `Failed to instantiate StarkGate L1 contract instances for ${this.config.chainName}. Error: ${error.message}`,
      );
    }
    logger.info(
      `StarkNet L1 RPC (${this.config.l1Rpc}) is configured for ${this.config.chainName}.`,
    );
    logger.info(`StarkNet L1 components initialization finished for ${this.config.chainName}.`);
  }

  protected async setupL2Listeners(): Promise<void> {
    if (this.config.useEndpoint) {
      logger.info(
        `L1 event listeners for L1 Depositor (e.g., TBTCBridgedToStarkNet) skipped for ${this.config.chainName} (using Endpoint mode).`,
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

    logger.info(`L1 event listener is active for ${this.config.chainName}`);

    // TODO: Unused, remove dead code
    // this.checkForPastL1DepositorEvents({
    //   fromBlock: this.config.l1StartBlock,
    // }).catch((error) => {
    //   logger.error(
    //     `Error during initial scan for past L1 Depositor bridge events for ${this.config.chainName}: ${error.message}`,
    //     error,
    //   );
    // });

    this.checkForPastL1DepositInitializedEvents({
      fromBlock: this.config.l1StartBlock,
    }).catch((error) => {
      logger.error(
        `Error during initial scan for past L1 DepositInitialized events for ${this.config.chainName}: ${error.message}`,
        error,
      );
    });
  }

  protected async processPastL1DepositorEvents(
    events: ethers.Event[],
    fromBlock: number,
    toBlock: number,
  ): Promise<void> {
    if (events.length > 0) {
      logger.info(
        `Found ${events.length} past TBTCBridgedToStarkNet L1 events for ${this.config.chainName} in range [${fromBlock} - ${toBlock}]`,
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
            true, // isPastEvent
          );
        } else {
          logger.warn(
            `checkForPastL1DepositorEvents | Event args undefined for past event. Tx: ${event.transactionHash}`,
          );
        }
      }
    } else {
      logger.info(
        `No past TBTCBridgedToStarkNet L1 events found for ${this.config.chainName} in block range ${fromBlock}-${toBlock}.`,
      );
    }
  }

  protected async checkForPastL1DepositorEvents(options: {
    fromBlock: number;
    toBlock?: number;
  }): Promise<void> {
    const blockChunkSize = 500;
    const latestBlock = await this.l1Provider.getBlockNumber();
    const toBlock = options.toBlock || latestBlock;

    logger.info(
      `Checking for past TBTCBridgedToStarkNet L1 events for ${this.config.chainName} from block ${options.fromBlock} to ${toBlock}`,
    );

    try {
      for (let fromBlock = options.fromBlock; fromBlock <= toBlock; fromBlock += blockChunkSize) {
        const currentToBlock = Math.min(fromBlock + blockChunkSize - 1, toBlock);
        const events = await this.l1DepositorContractProvider.queryFilter(
          this.l1DepositorContractProvider.filters.TBTCBridgedToStarkNet(),
          fromBlock,
          currentToBlock,
        );
        await this.processPastL1DepositorEvents(events, fromBlock, currentToBlock);
      }
    } catch (error: any) {
      logger.error(
        `Error querying past TBTCBridgedToStarkNet L1 events for ${this.config.chainName}: ${error.message}`,
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

      if (deposit.chainId !== this.config.chainName) {
        logger.error(
          `${logPrefix} Mismatched chain for DepositKey ${depositId} (Deposit Chain: ${deposit.chainId}) processed by handler for Chain: ${this.config.chainName}. This indicates an issue with event routing or deposit ID uniqueness. Skipping update.`,
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
    } catch (error: any) {
      logger.error(
        `${logPrefix} Error processing event data for DepositKey ${depositId}: ${error.message}`,
        error,
      );
    }
  }

  async getLatestBlock(): Promise<number> {
    if (this.config.useEndpoint) return 0;

    logger.warn(
      `StarkNet getLatestBlock NOT YET IMPLEMENTED for ${this.config.chainName}. Returning 0.`,
    );

    // FUTURE: Implement StarkNet L2 block number retrieval
    // When StarkNet L2 provider is available, this should:
    // 1. Query the latest block from StarkNet L2 RPC
    // 2. Return the block number for past deposit scanning
    // Example implementation:
    //   const block = await this.starknetL2Provider.getBlock('latest');
    //   return block.block_number;
    return 0; // Placeholder - indicates L2 past deposit scanning not available
  }

  async checkForPastDeposits(_options: {
    pastTimeInMinutes: number;
    latestBlock: number; // Represents block number
  }): Promise<void> {
    if (this.config.useEndpoint) return;

    logger.warn(`StarkNet checkForPastDeposits NOT YET IMPLEMENTED for ${this.config.chainName}.`);

    // FUTURE: Implement StarkNet L2 past event scanning
    // When StarkNet L2 provider is available, this should:
    // 1. Calculate start block from pastTimeInMinutes
    // 2. Query StarkNet events between start block and latest block
    // 3. Process any missed deposit-related events
    // Example implementation:
    //   const startBlock = latestBlock - Math.floor(pastTimeInMinutes * 60 / STARKNET_AVG_BLOCK_TIME);
    //   const events = await this.starknetL2Provider.getEvents({
    //     from_block: { block_number: startBlock },
    //     to_block: { block_number: latestBlock },
    //     address: this.config.l2ContractAddress,
    //     keys: ['DEPOSIT_EVENT_SELECTOR']
    //   });
    //   // Process events...
    return; // Placeholder - indicates L2 past deposit scanning not available
  }

  /**
   * Computes the depositKey (bytes32) for contract calls from a deposit object.
   * Always uses the canonical (non-reversed) hash for StarkNet.
   * @param deposit The deposit object
   * @returns The deposit key as a bytes32 hex string
   */
  private toDepositKey(deposit: Deposit): string {
    const fundingTxHash = getFundingTxHash(deposit.L1OutputEvent.fundingTx);
    // Explicitly do not reverse for StarkNet
    return getDepositKey(fundingTxHash, deposit.L1OutputEvent.reveal.fundingOutputIndex, false);
  }

  /**
   * Checks the deposit status on L1 using the correct depositKey (bytes32).
   * Accepts either a deposit object or a depositId string (decimal). For Starknet, if a string is passed,
   * attempts to look up the Deposit object. If not found, returns null. This ensures a symmetric API for all chains.
   * @param depositOrId The deposit ID (string) or Deposit object.
   * @returns The current status as a numeric enum value, or null if not found.
   */
  async checkDepositStatus(depositOrId: string | Deposit): Promise<number | null> {
    try {
      let deposit: Deposit | null;
      if (typeof depositOrId === 'string') {
        // For Starknet, depositKey is not derivable from just the ID, so we must look up the Deposit object.
        // This ensures a symmetric API for all chains and allows status checks by ID.
        deposit = await DepositStore.getById(depositOrId);
        if (!deposit) {
          logger.warn(`Deposit not found for ID: ${depositOrId} in checkDepositStatus.`);
          return null;
        }
      } else {
        deposit = depositOrId;
      }
      const depositKey = this.toDepositKey(deposit);
      if (!this.l1DepositorContractProvider) {
        logger.error('L1 Depositor contract provider not available for status check.');
        return null;
      }
      const status: number = await this.l1DepositorContractProvider.deposits(depositKey);
      return status;
    } catch (err) {
      logger.error('Error in checkDepositStatus:', err);
      return null;
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
    const depositKey = deposit.id; // Use the ID directly as it's the depositKey
    const logPrefix = `FINALIZE_DEPOSIT ${this.config.chainName} ${depositKey} |`;

    logger.info(`${logPrefix} Attempting to finalize deposit on L1 Depositor contract.`);

    if (!this.l1DepositorContract || !this.l1Signer) {
      const errorMessage =
        'L1 Depositor contract (signer) instance not available. Cannot finalize deposit.';
      logger.error(`${logPrefix} ${errorMessage}`);
      logErrorContext(
        `${logPrefix} L1 Depositor contract (signer) not available`,
        new Error(errorMessage),
      );
      await logDepositError(deposit.id, errorMessage, {
        internalError: 'L1 Depositor contract (signer) not available',
      });
      return undefined;
    }

    // 1. Pre-flight check: Verify deposit status on-chain
    const onChainStatus = await this.checkDepositStatus(deposit);
    logger.info(`${logPrefix} On-chain deposit status: ${onChainStatus}`);

    if (onChainStatus === null) {
      logger.error(
        `${logPrefix} Could not retrieve on-chain deposit status. Aborting finalization.`,
      );
      return undefined;
    }
    if (onChainStatus === 2) {
      // Finalized
      logger.warn(`${logPrefix} Deposit is already finalized on-chain. Skipping.`);
      // Consider returning a synthetic receipt if needed for endpoint consistency
      return undefined;
    }
    if (onChainStatus !== 1) {
      // Not Initialized
      logger.error(
        `${logPrefix} Deposit is not in Initialized state (state=${onChainStatus}). Cannot finalize. Aborting.`,
      );
      return undefined;
    }

    try {
      // 2. Fee Calculation - Get fee from StarkGate bridge
      let fee: ethers.BigNumber;
      if (this.starkGateBridgeContract) {
        try {
          fee = await this.starkGateBridgeContract.estimateDepositFeeWei();
          logger.info(
            `${logPrefix} Fee from StarkGate bridge: ${ethers.utils.formatEther(fee)} ETH`,
          );
        } catch (error: any) {
          logger.warn(
            `${logPrefix} Failed to get fee from StarkGate bridge, falling back to hardcoded value. Error: ${error.message}`,
          );
          fee = ethers.utils.parseEther('0.0001'); // Fallback fee from example
        }
      } else {
        logger.warn(`${logPrefix} StarkGate bridge contract not available, using hardcoded fee.`);
        fee = ethers.utils.parseEther('0.0001'); // Fallback fee from example
      }

      // 3. Explicit Gas Management
      logger.info(`${logPrefix} Estimating gas for finalizeDeposit...`);
      let gasEstimate: ethers.BigNumber;
      try {
        gasEstimate = await this.l1DepositorContract.estimateGas.finalizeDeposit(depositKey, {
          value: fee,
        });
        logger.info(`${logPrefix} Gas estimate: ${gasEstimate.toString()}`);
      } catch (error: any) {
        logger.warn(
          `${logPrefix} Gas estimation failed, using manual gas limit as fallback. Error: ${error.message}`,
        );
        gasEstimate = ethers.BigNumber.from(500000); // Fallback gas limit from example
      }

      const gasPrice = await this.l1Provider.getGasPrice();
      logger.info(
        `${logPrefix} Current gas price: ${ethers.utils.formatUnits(gasPrice, 'gwei')} gwei`,
      );

      const totalGasCost = gasEstimate.mul(gasPrice);
      const requiredBalance = fee.add(totalGasCost);

      // 4. Balance Check
      const relayerBalance = await this.l1Signer.getBalance();
      logger.info(
        `${logPrefix} Relayer L1 balance: ${ethers.utils.formatEther(relayerBalance)} ETH`,
      );
      logger.info(
        `${logPrefix} Required balance for finalization (fee + gas): ${ethers.utils.formatEther(requiredBalance)} ETH`,
      );

      if (relayerBalance.lt(requiredBalance)) {
        const errorMessage = `Insufficient ETH balance for finalization. Required: ${ethers.utils.formatEther(requiredBalance)}, Have: ${ethers.utils.formatEther(relayerBalance)}`;
        logger.error(`${logPrefix} ${errorMessage}`);
        await logDepositError(deposit.id, errorMessage, {
          requiredBalance: requiredBalance.toString(),
          relayerBalance: relayerBalance.toString(),
        });
        return undefined;
      }

      const txOverrides: PayableOverrides = {
        value: fee,
        gasLimit: gasEstimate.mul(120).div(100), // 20% buffer
        gasPrice: gasPrice.mul(110).div(100), // 10% buffer
      };

      logger.info(
        `${logPrefix} Calling L1 Depositor contract finalizeDeposit for depositKey: ${depositKey} with fee: ${ethers.utils.formatEther(
          txOverrides.value as BigNumberish,
        )} ETH, gasLimit: ${txOverrides.gasLimit?.toString()}, gasPrice: ${ethers.utils.formatUnits(txOverrides.gasPrice as BigNumberish, 'gwei')} gwei.`,
      );

      const txResponse = await this.l1DepositorContract.finalizeDeposit(depositKey, txOverrides);

      logger.info(
        `${logPrefix} L1 finalizeDeposit transaction sent. | Hash: ${txResponse.hash} | Waiting for receipt...`,
      );

      const txReceipt = await txResponse.wait(this.config.l1Confirmations);

      if (txReceipt.status === 1) {
        logger.info(
          `${logPrefix} L1 finalizeDeposit transaction successful. TxHash: ${txReceipt.transactionHash}, Block: ${txReceipt.blockNumber}.`,
        );
        await updateToFinalizedDeposit(deposit, { hash: txReceipt.transactionHash });
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
    const depositId = getDepositId(fundingTxHash, deposit.L1OutputEvent.reveal.fundingOutputIndex);
    const depositKey = this.toDepositKey(deposit);

    const logId = deposit.id || depositId;
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
    let l2DepositOwner: string = deposit.L1OutputEvent.l2DepositOwner;

    // Query on-chain directly via provider using depositKey (bytes32)
    const depositState = await this.l1DepositorContractProvider!.deposits(depositKey);
    logger.info(`${logPrefix} Deposit state for deposit key ${depositKey}: ${depositState}`);

    if (depositState !== 0) {
      logger.warn(
        `${logPrefix} Deposit already initialized. ID: ${depositId}. Returning existing initialization receipt.`,
      );
      const previousTxHash = deposit.hashes.eth.initializeTxHash;

      // Attempt to fetch the real receipt from the L1 provider
      if (previousTxHash) {
        try {
          const existingReceipt = await this.l1Provider.getTransactionReceipt(previousTxHash);
          if (existingReceipt) {
            return existingReceipt as ethers.providers.TransactionReceipt;
          }
        } catch (err: any) {
          logger.warn(
            `${logPrefix} Failed to fetch existing receipt for hash ${previousTxHash}: ${err.message}`,
          );
        }
      }

      // Fallback: synthetic receipt so endpoint responds with success
      return {
        status: depositState,
        transactionHash: previousTxHash || '',
        blockNumber: 0,
      } as ethers.providers.TransactionReceipt;
    }

    logger.info(`${logPrefix} Deposit not initialized. ID: ${depositId}`);

    try {
      l2DepositOwner = toUint256StarknetAddress(l2DepositOwner);
      if (!validateStarkNetAddress(l2DepositOwner)) {
        throw new Error('Invalid StarkNet address after conversion.');
      }
    } catch (err) {
      logger.error(
        `${logPrefix} Invalid deposit owner address: ${deposit.L1OutputEvent.l2DepositOwner}`,
      );
      await logDepositError(logId, 'Invalid deposit owner address.', {
        address: deposit.L1OutputEvent.l2DepositOwner,
      });
      return undefined;
    }

    try {
      logger.info(
        `${logPrefix} Calling L1 Depositor contract initializeDeposit for StarkNet recipient: ${l2DepositOwner})`,
      );
      logger.debug(`${logPrefix} L1 Contract Funding Tx Arg:`, fundingTx);
      logger.debug(`${logPrefix} L1 Contract Reveal Arg:`, reveal);

      const l2DepositOwnerBN = ethers.BigNumber.from(l2DepositOwner);
      const txResponse = await this.l1DepositorContract.initializeDeposit(
        fundingTx,
        reveal,
        l2DepositOwnerBN,
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
        await updateToInitializedDeposit(deposit, { hash: txReceipt.transactionHash });
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
    } catch (error: any) {
      logger.error(`${logPrefix} Error during L1 initializeDeposit: ${error.message}`);
      logErrorContext(`${logPrefix} Error during L1 initializeDeposit: ${error.message}`, error);

      await logDepositError(logId, `Error during L1 initializeDeposit: ${error.message}`, error);
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
        } catch (receiptError: any) {
          logger.warn(
            `hasDepositBeenMintedOnTBTC | Error fetching receipt for l1InitializeTxHash ${deposit.hashes.eth.initializeTxHash} to determine fromBlock: ${receiptError.message}`,
          );
        }
      }
      if (!fromBlock) {
        fromBlock =
          this.config.l1StartBlock > 0 ? Math.max(0, this.config.l1StartBlock - 10) : undefined;
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
    } catch (error: any) {
      const errorMsg = `Error checking deposit ${deposit.id} minting status on chain ${this.config.chainName}: ${error.message}`;
      logger.error(errorMsg, { error: logErrorContext(errorMsg, error) });
      logDepositError(deposit.id, errorMsg, error);
      return false;
    }
  }

  protected async checkForPastL1DepositInitializedEvents(options: {
    fromBlock: number;
    toBlock?: number;
  }): Promise<void> {
    const blockChunkSize = 500;
    const latestBlock = await this.l1Provider.getBlockNumber();
    const toBlock = options.toBlock || latestBlock;

    logger.info(
      `Checking for past DepositInitialized L1 events for ${this.config.chainName} from block ${options.fromBlock} to ${toBlock}`,
    );

    try {
      for (let fromBlock = options.fromBlock; fromBlock <= toBlock; fromBlock += blockChunkSize) {
        const currentToBlock = Math.min(fromBlock + blockChunkSize - 1, toBlock);
        const events = await this.l1DepositorContractProvider.queryFilter(
          this.l1DepositorContractProvider.filters.DepositInitialized(),
          fromBlock,
          currentToBlock,
        );
        await this.processPastL1DepositInitializedEvents(events, fromBlock, currentToBlock);
      }
    } catch (error: any) {
      logger.error(
        `Error querying past DepositInitialized L1 events for ${this.config.chainName}: ${error.message}`,
        error,
      );
    }
  }

  protected async processPastL1DepositInitializedEvents(
    events: ethers.Event[],
    fromBlock: number,
    toBlock: number,
  ): Promise<void> {
    if (events.length > 0) {
      logger.info(
        `Found ${events.length} past DepositInitialized L1 events for ${this.config.chainName} in range [${fromBlock} - ${toBlock}]`,
      );
      for (const event of events) {
        if (!event.args) {
          logger.warn(
            `processPastL1DepositInitializedEvents | Event args undefined for past event. Tx: ${event.transactionHash}`,
          );
          continue;
        }

        const depositId = event.args.depositKey.toString();
        const l1Sender = event.args.l1Sender;

        const existingDeposit = await DepositStore.getById(depositId);
        if (existingDeposit) {
          logger.debug(`Deposit ${depositId} already exists. Skipping.`);
          continue;
        }

        logger.info(
          `Found an untracked 'DepositInitialized' event for deposit ${depositId}. Attempting to back-fill.`,
        );

        // The DepositInitialized event does not contain the fundingTxHash or fundingOutputIndex.
        // We create a partial deposit record and let the normal finalization process handle it.
        const newDeposit = createPartialDepositFromOnChainData(
          depositId,
          l1Sender,
          this.config.chainName,
          event.transactionHash,
        );

        await DepositStore.create(newDeposit);
        logger.info(`Successfully back-filled missing deposit: ${depositId}`);
      }
    }
  }
}
