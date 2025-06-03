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

export class StarknetChainHandler extends BaseChainHandler<StarknetChainConfig> {
  // --- L1 StarkGate Contract Instances ---
  /** L1 StarkGate contract instance for sending transactions (uses L1 signer with nonce manager) */
  protected l1DepositorContract: StarkNetBitcoinDepositor | undefined;
  /** L1 StarkGate contract instance for read-only operations and event listening (uses L1 provider) */
  protected l1DepositorContractProvider: StarkNetBitcoinDepositor | undefined;

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
        `StarkNet L2 RPC (${this.config.l2Rpc}) and private key are configured for ${this.config.chainName}. Actual StarkNet L2 provider/account initialization will be handled in a subsequent task.`,
      );
      // NOTE: StarkNet L2 provider and account initialization pending implementation
      // Implementation will use starknet.js RpcProvider and Account:
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
    logger.warn(
      `StarkNet getLatestBlock NOT YET IMPLEMENTED for ${this.config.chainName}. Returning 0.`,
    );
    // NOTE: Implementation pending for latest StarkNet block number
    // Implementation will use: const block = await this.starknetProvider.getBlock('latest'); return block.block_number;
    return 0; // Placeholder
  }

  async checkForPastDeposits(_options: {
    pastTimeInMinutes: number;
    latestBlock: number; // Represents block number
  }): Promise<void> {
    if (this.config.useEndpoint) return;
    logger.warn(`StarkNet checkForPastDeposits NOT YET IMPLEMENTED for ${this.config.chainName}.`);
    // NOTE: Implementation pending for querying past StarkNet events
    // Implementation will use: await this.starknetProvider.getEvents({ from_block: { block_number: startBlock }, to_block: { block_number: endBlock }, address: contractAddress, keys: ['EVENT_SELECTOR'] });
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
