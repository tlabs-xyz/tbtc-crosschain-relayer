/**
 * Sei Network Chain Handler
 * 
 * Architecture: NTT Hub & Spoke with Wormhole Executor
 * 
 * IMPORTANT: Sei uses the "Manager with Executor" contract on L1 (Ethereum Mainnet/Sepolia).
 * The plain NTT Manager does NOT support Sei Network.
 * 
 * L1 Contract: L1BTCDepositorNttWithExecutor (Manager with Executor)
 * - Ethereum Mainnet: 0xd2d9c936165a85f27a5a7e07afb974d022b89463 (Deployed)
 * - Sepolia: 0x54DD7080aE169DD923fE56d0C4f814a0a17B8f41 (Manager with Executor deployed, L1BTCDepositorNttWithExecutor pending)
 * 
 * This handler interacts with the L1 contract on Ethereum for deposit operations.
 * All deposit logic happens on L1; L2 (Sei EVM) only receives bridged tokens via Wormhole NTT.
 */

import type { SeiChainConfig } from '../config/schemas/sei.chain.schema.js';
import { SeiChainConfigSchema } from '../config/schemas/sei.chain.schema.js';
import logger, { logErrorContext } from '../utils/Logger.js';
import { BaseChainHandler } from './BaseChainHandler.js';
import { ethers, type PayableOverrides, type BigNumberish, type BytesLike } from 'ethers';
import { SeiBitcoinDepositorABI } from '../interfaces/SeiBitcoinDepositor.js';
import type { SeiBitcoinDepositor } from '../interfaces/ISeiBitcoinDepositor.js';
import { DepositStore } from '../utils/DepositStore.js';
import { DepositStatus } from '../types/DepositStatus.enum.js';
import type { Deposit } from '../types/Deposit.type.js';
import type { Reveal } from '../types/Reveal.type.js';
import { getFundingTxHash } from '../utils/GetTransactionHash.js';
import {
  getDepositId,
  updateToInitializedDeposit,
  updateToFinalizedDeposit,
  getDepositKey,
  createPartialDepositFromOnChainData,
} from '../utils/Deposits.js';
import { logDepositError, logStatusChange } from '../utils/AuditLog.js';
import type { FundingTransaction } from '../types/FundingTransaction.type.js';

export class SeiChainHandler extends BaseChainHandler<SeiChainConfig> {
  // --- L1 NTT Contract Instances ---
  /** L1 NTT contract instance for sending transactions (uses L1 signer with nonce manager) */
  protected l1DepositorContract: SeiBitcoinDepositor;
  /** L1 NTT contract instance for read-only operations and event listening (uses L1 provider) */
  protected l1DepositorContractProvider: SeiBitcoinDepositor;

  constructor(config: SeiChainConfig) {
    super(config);
    try {
      SeiChainConfigSchema.parse(config);
      logger.info(`[${this.config.chainName}] SeiChainHandler constructed and validated`);
    } catch (error: any) {
      logger.error(`[${this.config.chainName}] Invalid Sei configuration: ${error.message}`, {
        zodErrors: error.errors,
      });
      throw new Error(`Invalid Sei configuration. Please check logs for details.`);
    }

    logger.debug(`[${this.config.chainName}] SeiChainHandler setup complete`);
  }

  protected override async initializeL2(): Promise<void> {
    logger.info(`[${this.config.chainName}] Initializing Sei L1 NTT components`);

    try {
      // For read-only operations and event listening:
      this.l1DepositorContractProvider = new ethers.Contract(
        this.config.l1BitcoinDepositorAddress,
        SeiBitcoinDepositorABI,
        this.l1Provider,
      ) as SeiBitcoinDepositor;
      logger.info(
        `[${this.config.chainName}] L1 Depositor contract provider instance created at ${this.config.l1BitcoinDepositorAddress}`,
      );

      // For sending transactions (if signer is available via BaseChainHandler's init)
      if (this.nonceManagerL1) {
        this.l1DepositorContract = new ethers.Contract(
          this.config.l1BitcoinDepositorAddress,
          SeiBitcoinDepositorABI,
          this.nonceManagerL1,
        ) as SeiBitcoinDepositor;
        logger.info(
          `[${this.config.chainName}] L1 Depositor contract signer instance (with NonceManager) created at ${this.config.l1BitcoinDepositorAddress}`,
        );
      } else if (this.l1Signer) {
        logger.warn(
          `[${this.config.chainName}] L1 NonceManager not available, but L1 Signer is. L1 Depositor contract will use signer directly. This might lead to nonce issues if not handled carefully.`,
        );
        this.l1DepositorContract = new ethers.Contract(
          this.config.l1BitcoinDepositorAddress,
          SeiBitcoinDepositorABI,
          this.l1Signer,
        ) as SeiBitcoinDepositor;
        logger.info(
          `[${this.config.chainName}] L1 Depositor contract signer instance (without NonceManager) created at ${this.config.l1BitcoinDepositorAddress}`,
        );
      } else {
        logger.warn(
          `[${this.config.chainName}] L1 signer not available (privateKey not configured or failed to init in Base). L1 Depositor contract transactions disabled. Read-only mode.`,
        );
      }
    } catch (error: any) {
      logger.error(
        `[${this.config.chainName}] Failed to instantiate Sei L1 NTT contract instances: ${error.message}`,
        error,
        { chainName: this.config.chainName },
      );
      throw new Error(
        `Failed to instantiate Sei L1 NTT contract instances. Error: ${error.message}`,
      );
    }
    logger.info(`[${this.config.chainName}] Sei L1 RPC (${this.config.l1Rpc}) is configured.`);
    logger.info(`[${this.config.chainName}] Sei L1 NTT components initialization finished.`);
  }

  protected async setupL2Listeners(): Promise<void> {
    logger.info(
      `[${this.config.chainName}] Setting up L1 TBTCBridgedViaNTT event listener on contract ${this.l1DepositorContractProvider.address}`,
    );

    this.l1DepositorContractProvider.on(
      'TBTCBridgedViaNTT',
      async (
        depositKey: string,
        recipient: string,
        amount: ethers.BigNumber,
        sequence: ethers.BigNumber,
        event: ethers.Event,
      ) => {
        await this.processTBTCBridgedViaNTTEvent(
          depositKey,
          recipient,
          amount,
          sequence,
          event.transactionHash,
          false,
        );
      },
    );

    logger.info(`[${this.config.chainName}] L1 event listener is active`);

    this.checkForPastL1DepositInitializedEvents({
      fromBlock: this.config.l1BitcoinDepositorStartBlock,
    }).catch((error) => {
      logger.error(
        `[${this.config.chainName}] Error during initial scan for past L1 DepositInitialized events: ${error.message}`,
        error,
        { chainName: this.config.chainName },
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
        `[${this.config.chainName}] Found ${events.length} past TBTCBridgedViaNTT L1 events in range [${fromBlock} - ${toBlock}]`,
      );
      for (const event of events) {
        if (event.args) {
          const depositKey = event.args.depositKey as string;
          const recipient = event.args.recipient as string;
          const amount = event.args.amount as ethers.BigNumber;
          const sequence = event.args.sequence as ethers.BigNumber;
          await this.processTBTCBridgedViaNTTEvent(
            depositKey,
            recipient,
            amount,
            sequence,
            event.transactionHash,
            true, // isPastEvent
          );
        } else {
          logger.warn(
            `[${this.config.chainName}] checkForPastL1DepositorEvents | Event args undefined for past event. Tx: ${event.transactionHash}`,
          );
        }
      }
    } else {
      logger.info(
        `[${this.config.chainName}] No past TBTCBridgedViaNTT L1 events found in block range ${fromBlock}-${toBlock}.`,
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
      `[${this.config.chainName}] Checking for past TBTCBridgedViaNTT L1 events from block ${options.fromBlock} to ${toBlock}`,
    );

    try {
      for (let fromBlock = options.fromBlock; fromBlock <= toBlock; fromBlock += blockChunkSize) {
        const currentToBlock = Math.min(fromBlock + blockChunkSize - 1, toBlock);
        const events = await this.l1DepositorContractProvider.queryFilter(
          this.l1DepositorContractProvider.filters.TBTCBridgedViaNTT(),
          fromBlock,
          currentToBlock,
        );
        await this.processPastL1DepositorEvents(events, fromBlock, currentToBlock);
      }
    } catch (error: any) {
      logger.error(
        `[${this.config.chainName}] Error querying past TBTCBridgedViaNTT L1 events: ${error.message}`,
        error,
        { chainName: this.config.chainName },
      );
    }
  }

  protected async processTBTCBridgedViaNTTEvent(
    depositKeyOrId: string | BytesLike,
    recipient: string,
    amount: ethers.BigNumber,
    sequence: ethers.BigNumber,
    transactionHash: string,
    isPastEvent: boolean = false,
  ): Promise<void> {
    const logPrefix = isPastEvent
      ? `PastEvent | TBTCBridgedViaNTT:`
      : `LiveEvent | TBTCBridgedViaNTT:`;

    const depositId =
      typeof depositKeyOrId === 'string' ? depositKeyOrId : ethers.utils.hexlify(depositKeyOrId);

    logger.info(
      `[${this.config.chainName}] ${logPrefix} Processing | DepositId: ${depositId} | Amount: ${amount.toString()} | Recipient: ${recipient} | L1 Tx: ${transactionHash} | Sequence: ${sequence.toString()}`,
    );

    try {
      const deposit = await DepositStore.getById(depositId);
      if (!deposit) {
        logger.warn(
          `[${this.config.chainName}] ${logPrefix} Unknown deposit. ID: ${depositId}. Ignoring.`,
        );
        return;
      }

      if (deposit.status === DepositStatus.BRIDGED) {
        if (isPastEvent) {
          logger.debug(
            `[${this.config.chainName}] ${logPrefix} Deposit already BRIDGED. ID: ${depositId}. Skipping update.`,
          );
        } else {
          logger.warn(
            `[${this.config.chainName}] ${logPrefix} Deposit already BRIDGED. ID: ${depositId}. Live event may be a replay. Skipping update.`,
          );
        }
        return;
      }

      if (deposit.chainId !== this.config.chainName) {
        logger.error(
          `[${this.config.chainName}] ${logPrefix} Mismatched chain for depositKey ${depositId} (actual: ${deposit.chainId}). Skipping update.`,
        );
        return;
      }

      logger.info(
        `[${this.config.chainName}] ${logPrefix} Updating deposit to BRIDGED | ID: ${depositId}`,
      );

      deposit.status = DepositStatus.BRIDGED;
      deposit.dates.bridgedAt = Math.floor(Date.now() / 1000);

      // Store Sei-specific bridging data
      if (!deposit.hashes.sei) {
        deposit.hashes.sei = {};
      }
      deposit.hashes.sei = {
        ...deposit.hashes.sei,
        l1BridgeTxHash: transactionHash,
        wormholeSequence: sequence.toString(),
      };

      await DepositStore.update(deposit);
      logger.info(
        `[${this.config.chainName}] ${logPrefix} Deposit updated to BRIDGED. ID: ${deposit.id}. L1 Tx: ${transactionHash}`,
      );
    } catch (error: any) {
      logger.error(
        `[${this.config.chainName}] ${logPrefix} Error processing event data for depositKey ${depositId}: ${error.message}`,
        error,
        { chainName: this.config.chainName },
      );
    }
  }

  override async getLatestBlock(): Promise<number> {
    if (this.config.useEndpoint) return 0;

    logger.warn(
      `[${this.config.chainName}] Sei getLatestBlock NOT YET IMPLEMENTED. Returning 0.`,
    );
    return 0;
  }

  override async checkForPastDeposits(_options: {
    pastTimeInMinutes: number;
    latestBlock: number;
  }): Promise<void> {
    if (this.config.useEndpoint) return;

    logger.warn(`[${this.config.chainName}] Sei checkForPastDeposits NOT YET IMPLEMENTED.`);
    return;
  }

  /**
   * Computes the depositKey (bytes32) for contract calls from a deposit object.
   * Always uses the canonical (non-reversed) hash for Sei.
   * @param deposit The deposit object
   * @returns The deposit key as a bytes32 hex string
   */
  private toDepositKey(deposit: Deposit): string {
    const fundingTxHash = getFundingTxHash(deposit.L1OutputEvent.fundingTx);
    // Explicitly do not reverse for Sei
    return getDepositKey(fundingTxHash, deposit.L1OutputEvent.reveal.fundingOutputIndex, false);
  }

  /**
   * Computes the depositKey (bytes32) for contract calls from a deposit object.
   * This handles both "full" deposits created via API and "partial" deposits
   * created by back-filling from on-chain events.
   * @param deposit The deposit object
   * @returns The deposit key as a bytes32 hex string
   */
  private _getOnChainDepositKey(deposit: Deposit): string {
    if (!deposit.fundingTxHash || !deposit.L1OutputEvent) {
      const depositKeyAsBN = ethers.BigNumber.from(deposit.id);
      return ethers.utils.hexZeroPad(depositKeyAsBN.toHexString(), 32);
    }
    return this.toDepositKey(deposit);
  }

  /**
   * Checks the deposit status on L1 using the correct depositKey (bytes32).
   * @param depositOrId The deposit ID (string) or Deposit object.
   * @returns The current status as a numeric enum value, or null if not found.
   */
  override async checkDepositStatus(depositOrId: string | Deposit): Promise<number | null> {
    try {
      let deposit: Deposit | null;
      if (typeof depositOrId === 'string') {
        deposit = await DepositStore.getById(depositOrId);
        if (!deposit) {
          logger.warn(
            `[${this.config.chainName}] Deposit not found for ID: ${depositOrId} in checkDepositStatus.`,
          );
          return null;
        }
      } else {
        deposit = depositOrId;
      }

      const depositKey = this._getOnChainDepositKey(deposit);

      if (!this.l1DepositorContractProvider) {
        logger.error(
          `[${this.config.chainName}] L1 Depositor contract provider not available for status check.`,
        );
        return null;
      }
      const status: number = await this.l1DepositorContractProvider.deposits(depositKey);
      return status;
    } catch (err) {
      logger.error(`[${this.config.chainName}] Error in checkDepositStatus:`, err, {
        chainName: this.config.chainName,
      });
      return null;
    }
  }

  /**
   * Finalize a deposit on the L1 NTT bridge.
   * @param deposit The deposit object.
   * @returns A promise that resolves with the transaction receipt if successful, otherwise undefined.
   */
  public override async finalizeDeposit(
    deposit: Deposit,
  ): Promise<ethers.providers.TransactionReceipt | undefined> {
    const depositKey = this._getOnChainDepositKey(deposit);
    const logPrefix = `FINALIZE_DEPOSIT ${this.config.chainName} ${deposit.id} |`;

    logger.info(
      `[${this.config.chainName}] ${logPrefix} Attempting to finalize deposit on L1 Depositor contract (key: ${depositKey}).`,
    );

    if (!this.l1DepositorContract || !this.l1Signer) {
      const errorMessage =
        'L1 Depositor contract (signer) instance not available. Cannot finalize deposit.';
      logger.error(`[${this.config.chainName}] ${logPrefix} ${errorMessage}`);
      await logDepositError(deposit.id, errorMessage, {
        internalError: 'L1 Depositor contract (signer) not available',
      });
      return undefined;
    }

    // 1. Pre-flight check: Verify deposit status on-chain
    const onChainStatus = await this.checkDepositStatus(deposit);
    logger.info(
      `[${this.config.chainName}] ${logPrefix} On-chain deposit status: ${onChainStatus}`,
    );

    switch (onChainStatus) {
      case null:
      case undefined:
        logger.error(
          `[${this.config.chainName}] ${logPrefix} Could not retrieve on-chain deposit status. Aborting finalization.`,
        );
        return undefined;
      case DepositStatus.FINALIZED:
        logger.warn(
          `[${this.config.chainName}] ${logPrefix} Deposit is already finalized on-chain. Skipping.`,
        );
        return undefined;
      case DepositStatus.INITIALIZED:
        break; // Proceed with finalization
      default:
        logger.error(
          `[${this.config.chainName}] ${logPrefix} Deposit is not in Initialized state (state=${onChainStatus}). Cannot finalize. Aborting.`,
        );
        return undefined;
    }

    try {
      // 2. Explicit Gas Management
      logger.info(`[${this.config.chainName}] ${logPrefix} Estimating gas for finalizeDeposit...`);
      let gasEstimate: ethers.BigNumber;
      try {
        gasEstimate = await this.l1DepositorContract.estimateGas.finalizeDeposit(depositKey);
        logger.info(
          `[${this.config.chainName}] ${logPrefix} Gas estimate: ${gasEstimate.toString()}`,
        );
      } catch (error: any) {
        logger.warn(
          `[${this.config.chainName}] ${logPrefix} Gas estimation failed, using manual gas limit as fallback.`,
        );
        gasEstimate = ethers.BigNumber.from(500000);
      }

      const gasPrice = await this.l1Provider.getGasPrice();
      logger.info(
        `[${this.config.chainName}] ${logPrefix} Current gas price: ${ethers.utils.formatUnits(gasPrice, 'gwei')} gwei`,
      );

      const totalGasCost = gasEstimate.mul(gasPrice);

      // 3. Balance Check
      const relayerBalance = await this.l1Signer.getBalance();
      logger.info(
        `[${this.config.chainName}] ${logPrefix} Relayer L1 balance: ${ethers.utils.formatEther(relayerBalance)} ETH`,
      );
      logger.info(
        `[${this.config.chainName}] ${logPrefix} Required balance for finalization (gas): ${ethers.utils.formatEther(totalGasCost)} ETH`,
      );

      if (relayerBalance.lt(totalGasCost)) {
        const errorMessage = `Insufficient ETH balance for finalization. Required: ${ethers.utils.formatEther(totalGasCost)}, Have: ${ethers.utils.formatEther(relayerBalance)}`;
        logger.error(`[${this.config.chainName}] ${logPrefix} ${errorMessage}`);
        await logDepositError(deposit.id, errorMessage, {
          requiredBalance: totalGasCost.toString(),
          relayerBalance: relayerBalance.toString(),
        });
        return undefined;
      }

      const txOverrides: PayableOverrides = {
        gasLimit: gasEstimate.mul(120).div(100), // 20% buffer
        gasPrice: gasPrice.mul(110).div(100), // 10% buffer
      };

      // 4. Simulate Transaction
      try {
        logger.info(`[${this.config.chainName}] ${logPrefix} Simulating finalizeDeposit call...`);
        await this.l1DepositorContract.callStatic.finalizeDeposit(depositKey, txOverrides);
        logger.info(
          `[${this.config.chainName}] ${logPrefix} Simulation successful. Proceeding with actual transaction.`,
        );
      } catch (error: any) {
        const errorMessage = `Simulation failed with error: ${error.message}`;
        logger.error(
          `[${this.config.chainName}] ${logPrefix} ${errorMessage}. Aborting finalization.`,
        );
        logErrorContext(`${logPrefix} ${errorMessage}`, error, {
          chainName: this.config.chainName,
        });
        await logDepositError(
          deposit.id,
          `L1 finalizeDeposit simulation failed: ${error.message}`,
          { error },
        );
        return undefined;
      }

      logger.info(
        `[${this.config.chainName}] ${logPrefix} Calling L1 Depositor contract finalizeDeposit for depositKey: ${depositKey} with gasLimit: ${txOverrides.gasLimit?.toString()}, gasPrice: ${ethers.utils.formatUnits(txOverrides.gasPrice as BigNumberish, 'gwei')} gwei.`,
      );

      const txResponse = await this.l1DepositorContract.finalizeDeposit(depositKey, txOverrides);

      logger.info(
        `[${this.config.chainName}] ${logPrefix} L1 finalizeDeposit transaction sent. | Hash: ${txResponse.hash} | Waiting for receipt...`,
      );

      const txReceipt = await txResponse.wait(this.config.l1Confirmations);

      if (txReceipt.status === 1) {
        logger.info(
          `[${this.config.chainName}] ${logPrefix} L1 finalizeDeposit transaction successful. TxHash: ${txReceipt.transactionHash}, Block: ${txReceipt.blockNumber}.`,
        );
        await updateToFinalizedDeposit(deposit, { hash: txReceipt.transactionHash });
        return txReceipt;
      } else {
        const revertMsg = `${logPrefix} L1 finalizeDeposit transaction reverted. TxHash: ${txReceipt.transactionHash}, Block: ${txReceipt.blockNumber}.`;
        logger.error(`[${this.config.chainName}] ${revertMsg}`);
        logErrorContext(revertMsg, { receipt: txReceipt }, { chainName: this.config.chainName });
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
      logger.error(
        `[${this.config.chainName}] ${logPrefix} Error during L1 finalizeDeposit: ${error.message}`,
      );
      logErrorContext(`${logPrefix} Error during L1 finalizeDeposit: ${error.message}`, error, {
        chainName: this.config.chainName,
      });
      await logDepositError(deposit.id, `Error during L1 finalizeDeposit: ${error.message}`, error);
      return undefined;
    }
  }

  /**
   * Initialize a deposit on the L1 NTT bridge.
   * @param deposit The deposit object containing all necessary L1 event data.
   * @returns A promise that resolves with the L1 transaction receipt if successful, otherwise undefined.
   */
  public override async initializeDeposit(
    deposit: Deposit,
  ): Promise<ethers.providers.TransactionReceipt | undefined> {
    const FALLBACK_GAS_LIMIT = ethers.BigNumber.from(500000);

    const fundingTxHash = getFundingTxHash(deposit.L1OutputEvent.fundingTx);
    const depositId = getDepositId(fundingTxHash, deposit.L1OutputEvent.reveal.fundingOutputIndex);
    const depositKey = this.toDepositKey(deposit);

    const logId = deposit.id || depositId;
    const logPrefix = `INITIALIZE_DEPOSIT ${this.config.chainName} ${logId} |`;

    const logAndReturnError = async (message: string, errorObj?: any): Promise<undefined> => {
      logger.error(`[${this.config.chainName}] ${logPrefix} ${message}`);
      if (errorObj) {
        logErrorContext(`${logPrefix} ${message}`, errorObj, { chainName: this.config.chainName });
      }
      await logDepositError(logId, message, errorObj);
      return undefined;
    };

    logger.info(
      `[${this.config.chainName}] ${logPrefix} Attempting to initialize deposit on L1 Depositor contract.`,
    );

    if (!this.l1DepositorContract) {
      return await logAndReturnError(
        'L1 Depositor contract (signer) instance not available for initialization.',
        { internalError: 'L1 Depositor contract (signer) not available' },
      );
    }

    const fundingTx: FundingTransaction = deposit.L1OutputEvent.fundingTx;
    const reveal: Reveal = deposit.L1OutputEvent.reveal;
    const l2DepositOwner: string = deposit.L1OutputEvent.l2DepositOwner;

    // Check deposit state on-chain
    const depositState = await this.l1DepositorContractProvider!.deposits(depositKey);
    logger.info(
      `[${this.config.chainName}] ${logPrefix} Deposit state for deposit key ${depositKey}: ${depositState}`,
    );

    if (depositState !== 0) {
      logger.warn(
        `[${this.config.chainName}] ${logPrefix} Deposit already initialized. ID: ${depositId}. Returning existing initialization receipt.`,
      );
      const previousTxHash = deposit.hashes.eth.initializeTxHash;

      if (previousTxHash) {
        try {
          const existingReceipt = await this.l1Provider.getTransactionReceipt(previousTxHash);
          if (existingReceipt) {
            return existingReceipt as ethers.providers.TransactionReceipt;
          }
        } catch (err: any) {
          logger.warn(
            `[${this.config.chainName}] ${logPrefix} Failed to fetch existing receipt for hash ${previousTxHash}: ${err.message}`,
          );
        }
      }

      // Fallback: synthetic receipt
      return {
        status: depositState,
        transactionHash: previousTxHash || '',
        blockNumber: 0,
      } as ethers.providers.TransactionReceipt;
    }

    logger.info(
      `[${this.config.chainName}] ${logPrefix} Deposit not initialized. ID: ${depositId}`,
    );

    // Validate EVM address format
    if (!ethers.utils.isAddress(l2DepositOwner)) {
      return await logAndReturnError(`Invalid EVM deposit owner address: ${l2DepositOwner}`, {
        address: l2DepositOwner,
      });
    }

    try {
      logger.info(
        `[${this.config.chainName}] ${logPrefix} Preparing to estimate gas and simulate initializeDeposit...`,
      );

      // Gas estimation
      let gasEstimate: ethers.BigNumber;
      try {
        gasEstimate = await this.l1DepositorContract.estimateGas.initializeDeposit(
          fundingTx,
          reveal,
          l2DepositOwner,
        );
        logger.info(
          `[${this.config.chainName}] ${logPrefix} Gas estimate for initializeDeposit: ${gasEstimate.toString()}`,
        );
      } catch (error: any) {
        logger.warn(
          `[${this.config.chainName}] ${logPrefix} Gas estimation failed, using fallback.`,
        );
        gasEstimate = FALLBACK_GAS_LIMIT;
      }

      // Gas price
      const gasPrice = await this.l1Provider.getGasPrice();
      logger.info(
        `[${this.config.chainName}] ${logPrefix} Current gas price: ${ethers.utils.formatUnits(gasPrice, 'gwei')} gwei`,
      );

      // Balance check
      const totalGasCost = gasEstimate.mul(gasPrice);
      const relayerBalance = await this.l1Signer.getBalance();
      logger.info(
        `[${this.config.chainName}] ${logPrefix} Relayer L1 balance: ${ethers.utils.formatEther(relayerBalance)} ETH`,
      );
      logger.info(
        `[${this.config.chainName}] ${logPrefix} Required balance for initialization (gas): ${ethers.utils.formatEther(totalGasCost)} ETH`,
      );

      if (relayerBalance.lt(totalGasCost)) {
        return await logAndReturnError(
          `Insufficient ETH balance for initialization. Required: ${ethers.utils.formatEther(totalGasCost)}, Have: ${ethers.utils.formatEther(relayerBalance)}`,
          {
            requiredBalance: totalGasCost.toString(),
            relayerBalance: relayerBalance.toString(),
          },
        );
      }

      const txOverrides: PayableOverrides = {
        gasLimit: gasEstimate.mul(120).div(100), // 20% buffer
        gasPrice: gasPrice.mul(110).div(100), // 10% buffer
      };

      // Simulate transaction
      try {
        logger.info(`[${this.config.chainName}] ${logPrefix} Simulating initializeDeposit call...`);
        await this.l1DepositorContract.callStatic.initializeDeposit(
          fundingTx,
          reveal,
          l2DepositOwner,
          txOverrides,
        );
        logger.info(
          `[${this.config.chainName}] ${logPrefix} Simulation successful. Proceeding with actual transaction.`,
        );
      } catch (error: any) {
        return await logAndReturnError(`Simulation failed: ${error.message}`, { error });
      }

      logger.info(
        `[${this.config.chainName}] ${logPrefix} Calling L1 Depositor contract initializeDeposit for Sei recipient: ${l2DepositOwner} with gasLimit: ${txOverrides.gasLimit?.toString()}, gasPrice: ${ethers.utils.formatUnits(txOverrides.gasPrice as BigNumberish, 'gwei')} gwei.`,
      );

      // Send transaction
      const txResponse = await this.l1DepositorContract.initializeDeposit(
        fundingTx,
        reveal,
        l2DepositOwner,
        txOverrides,
      );

      logger.info(
        `[${this.config.chainName}] ${logPrefix} L1 initializeDeposit transaction sent. TxHash: ${txResponse.hash}. Waiting for confirmations...`,
      );
      deposit.hashes.eth.initializeTxHash = txResponse.hash;

      const txReceipt = await txResponse.wait(this.config.l1Confirmations);

      if (txReceipt.status === 1) {
        logger.info(
          `[${this.config.chainName}] ${logPrefix} L1 initializeDeposit transaction successful. TxHash: ${txReceipt.transactionHash}, Block: ${txReceipt.blockNumber}.`,
        );
        await updateToInitializedDeposit(deposit, { hash: txReceipt.transactionHash });
        return txReceipt;
      } else {
        const revertMsg = `${logPrefix} L1 initializeDeposit transaction reverted. TxHash: ${txReceipt.transactionHash}, Block: ${txReceipt.blockNumber}.`;
        logger.error(`[${this.config.chainName}] ${revertMsg}`);
        logErrorContext(revertMsg, { receipt: txReceipt }, { chainName: this.config.chainName });
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
      return await logAndReturnError(`Error during L1 initializeDeposit: ${error.message}`, error);
    }
  }

  /**
   * Checks if the tBTC protocol has finalized the minting for a given deposit.
   */
  protected async hasDepositBeenMintedOnTBTC(deposit: Deposit): Promise<boolean> {
    if (!this.tbtcVaultProvider) {
      logger.warn(
        `[${this.config.chainName}] hasDepositBeenMintedOnTBTC | TBTCVault provider not available. Cannot check minting status for deposit ${deposit.id}.`,
      );
      return false;
    }

    const depositKeyUint256 = ethers.BigNumber.from(deposit.id);

    try {
      logger.debug(
        `[${this.config.chainName}] hasDepositBeenMintedOnTBTC | Checking for OptimisticMintingFinalized event for depositKey ${deposit.id}`,
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
            `[${this.config.chainName}] hasDepositBeenMintedOnTBTC | Error fetching receipt: ${receiptError.message}`,
          );
        }
      }
      if (!fromBlock) {
        fromBlock =
          this.config.l1BitcoinDepositorStartBlock > 0
            ? Math.max(0, this.config.l1BitcoinDepositorStartBlock - 10)
            : undefined;
      }

      if (fromBlock) {
        const events = await this.tbtcVaultProvider.queryFilter(
          this.tbtcVaultProvider.filters.OptimisticMintingFinalized(depositKeyUint256),
          fromBlock,
        );

        if (events.length > 0) {
          logger.info(
            `[${this.config.chainName}] hasDepositBeenMintedOnTBTC | Found OptimisticMintingFinalized event for depositKey ${deposit.id}`,
          );
          return true;
        } else {
          logger.info(
            `[${this.config.chainName}] hasDepositBeenMintedOnTBTC | No OptimisticMintingFinalized event found for depositKey ${deposit.id}`,
          );
          return false;
        }
      } else {
        logger.warn(
          `[${this.config.chainName}] hasDepositBeenMintedOnTBTC | No valid fromBlock determined for depositKey ${deposit.id}.`,
        );
        return false;
      }
    } catch (error: any) {
      const errorMsg = `Error checking deposit ${deposit.id} minting status: ${error.message}`;
      logger.error(`[${this.config.chainName}] ${errorMsg}`, error, {
        chainName: this.config.chainName,
      });
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
      `[${this.config.chainName}] Checking for past DepositInitialized L1 events from block ${options.fromBlock} to ${toBlock}`,
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
        { chainName: this.config.chainName },
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
        `[${this.config.chainName}] Found ${events.length} past DepositInitialized L1 events in range [${fromBlock} - ${toBlock}]`,
      );
      for (const event of events) {
        if (!event.args) {
          logger.warn(
            `[${this.config.chainName}] processPastL1DepositInitializedEvents | Event args undefined. Tx: ${event.transactionHash}`,
          );
          continue;
        }

        const depositId = event.args.depositKey.toString();
        const l1Sender = event.args.l1Sender;

        const existingDeposit = await DepositStore.getById(depositId);
        if (existingDeposit) {
          logger.debug(`[${this.config.chainName}] Deposit ${depositId} already exists. Skipping.`);
          continue;
        }

        logger.info(
          `[${this.config.chainName}] Found an untracked 'DepositInitialized' event for deposit ${depositId}. Attempting to back-fill.`,
        );

        const newDeposit = createPartialDepositFromOnChainData(
          depositId,
          l1Sender,
          this.config.chainName,
          event.transactionHash,
        );

        await DepositStore.create(newDeposit);
        logger.info(
          `[${this.config.chainName}] Successfully back-filled missing deposit: ${depositId}`,
        );
      }
    }
  }
}

