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
import type { EthersStarkNetBitcoinDepositor } from '../interfaces/IStarkNetBitcoinDepositor.js';
import type { EthersStarkGateBridge } from '../interfaces/IStarkGateBridge.js';
import { IStarkGateBridgeABI } from '../interfaces/IStarkGateBridge.abi.js';

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

export class StarknetChainHandler extends BaseChainHandler<StarknetChainConfig> {
  // --- L1 StarkGate Contract Instances ---
  /** L1 StarkGate contract instance for sending transactions (uses L1 signer with nonce manager) */
  protected l1DepositorContract: EthersStarkGateBridge | undefined;
  /** L1 StarkGate contract instance for read-only operations and event listening (uses L1 provider) */
  protected l1DepositorContractProvider: EthersStarkGateBridge | undefined;

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
        IStarkGateBridgeABI,
        this.l1Provider,
      ) as EthersStarkNetBitcoinDepositor;
      logger.info(
        `L1 Depositor contract provider instance created for ${this.config.chainName} at ${this.config.l1ContractAddress}`,
      );

      // For sending transactions (if signer is available via BaseChainHandler's init)
      if (this.nonceManagerL1) {
        this.l1DepositorContract = new ethers.Contract(
          this.config.l1ContractAddress,
          IStarkGateBridgeABI,
          this.nonceManagerL1,
        ) as EthersStarkNetBitcoinDepositor;
        logger.info(
          `L1 Depositor contract signer instance (with NonceManager) created for ${this.config.chainName} at ${this.config.l1ContractAddress}`,
        );
      } else if (this.l1Signer) {
        logger.warn(
          `L1 NonceManager not available for ${this.config.chainName}, but L1 Signer is. L1 Depositor contract will use signer directly. This might lead to nonce issues if not handled carefully.`,
        );
        this.l1DepositorContract = new ethers.Contract(
          this.config.l1ContractAddress,
          IStarkGateBridgeABI,
          this.l1Signer,
        ) as EthersStarkNetBitcoinDepositor;
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
      this.l1DepositorContractProvider.filters.TBTCBridgedToStarkNet(),
      async (
        depositKey: string,
        starkNetRecipient: ethers.BigNumber,
        amount: ethers.BigNumber,
        messageNonce: ethers.BigNumber,
        event: ethers.Event,
      ) => {
        await this.processDepositBridgedToStarkNetEvent(
          depositKey,
          starkNetRecipient,
          amount,
          messageNonce,
          event.transactionHash,
          false,
        );
      },
    );

    logger.info(
      `L1 TBTCBridgedToStarkNet event listener is active for ${this.config.chainName}`,
    );

    if (this.config.l2StartBlock > 0) {
      this.checkForPastL1DepositorEvents({ fromBlock: this.config.l2StartBlock }).catch((error) => {
        logger.error(
          `Error during initial scan for past L1 Depositor bridge events for ${this.config.chainName}: ${error.message}`,
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
            await this.processDepositBridgedToStarkNetEvent(
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
    } catch (error: any) {
      logger.error(
        `Error querying past TBTCBridgedToStarkNet L1 events for ${this.config.chainName}: ${error.message}`,
        error,
      );
    }
  }

  protected async processDepositBridgedToStarkNetEvent(
    depositKeyOrId: string | BytesLike,
    starkNetRecipient: ethers.BigNumber,
    amount: ethers.BigNumber,
    messageNonce: ethers.BigNumber,
    transactionHash: string,
    isPastEvent: boolean = false,
  ): Promise<void> {
    const logPrefix = isPastEvent
      ? `PastEvent | DepositBridgedToStarkNet for ${this.config.chainName}:`
      : `LiveEvent | DepositBridgedToStarkNet for ${this.config.chainName}:`;

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
      deposit.L1OutputEvent.reveal[0],
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

    let messageFee: ethers.BigNumber;
    try {
      // First try to use the dynamic fee estimation from StarkGate
      try {
        const dynamicFee = await this.l1DepositorContract.estimateMessageFee();
        // Apply a 10% buffer to the dynamic fee to account for gas price fluctuations
        const buffer = dynamicFee.mul(10).div(100);
        messageFee = dynamicFee.add(buffer);
        logger.info(
          `${logPrefix} Dynamically quoted L1->L2 message fee: ${ethers.utils.formatEther(messageFee)} ETH (includes 10% buffer)`,
        );
      } catch (estimateError) {
        logger.warn(
          `${logPrefix} Failed to get dynamic fee estimate from StarkGate: ${estimateError.message}. Falling back to static methods.`,
        );
        
        if (this.l1DepositorContract.callStatic.quoteFinalizeDeposit) {
          messageFee = await this.l1DepositorContract.callStatic.quoteFinalizeDeposit();
          logger.info(
            `${logPrefix} Static quoted L1->L2 message fee: ${ethers.utils.formatEther(messageFee)} ETH`,
          );
        } else if (
          this.config.l1FeeAmountWei &&
          ethers.BigNumber.from(this.config.l1FeeAmountWei).gt(0)
        ) {
          messageFee = ethers.BigNumber.from(this.config.l1FeeAmountWei);
          logger.warn(
            `${logPrefix} Using configured l1FeeAmountWei as L1->L2 message fee: ${ethers.utils.formatEther(messageFee)} ETH. Review if this is the correct fee for finalizeDeposit.`,
          );
        } else {
          logger.error(
            `${logPrefix} L1->L2 message fee for finalizeDeposit is not configured or quotable and is zero. Cannot proceed.`,
          );
          await logDepositError(
            deposit.id,
            'L1->L2 message fee for finalizeDeposit is zero or unconfigured.',
            {},
          );
          return undefined;
        }
      }
    } catch (quoteError: any) {
      logger.error(
        `${logPrefix} Error quoting L1->L2 message fee: ${quoteError.message}`,
        quoteError,
      );
      await logDepositError(
        deposit.id,
        `Error quoting L1->L2 message fee: ${quoteError.message}`,
        quoteError,
      );
      return undefined;
    }

    if (messageFee.isZero()) {
      logger.error(`${logPrefix} L1->L2 message fee is zero. Cannot finalize deposit.`);
      await logDepositError(deposit.id, 'Quoted or configured L1->L2 message fee is zero.', {
        fee: messageFee.toString(),
      });
      return undefined;
    }

    const txOverrides: PayableOverrides = {
      value: messageFee,
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
        await updateToFinalizedDeposit(deposit, txReceipt);
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
    const depositKeyBytes32 = getDepositId(fundingTxHash, deposit.L1OutputEvent.reveal[0]);
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
    const revealData: Reveal = deposit.L1OutputEvent.reveal;
    const l2DepositOwner: string = deposit.L1OutputEvent.l2DepositOwner;

    if (!validateStarkNetAddress(l2DepositOwner)) {
      logger.error(`${logPrefix} Invalid StarkNet recipient address: ${l2DepositOwner}`);
      await logDepositError(logId, 'Invalid StarkNet recipient address.', {
        address: l2DepositOwner,
      });
      return undefined;
    }
    const formattedL2DepositOwnerAsBytes32 = formatStarkNetAddressForContract(l2DepositOwner);

    // Based on IStarkGateBridgeABI, initializeDeposit is non-payable.
    // Therefore, we do not send a `value` (msg.value).
    // If l1FeeAmountWei was intended for gas parameters, that would be a different logic.
    const txOverrides: Overrides = {}; // No value needed for non-payable function

    try {
      logger.info(
        `${logPrefix} Calling L1 Depositor contract initializeDeposit for StarkNet recipient (as _depositOwner/extraData): ${formattedL2DepositOwnerAsBytes32} (original: ${l2DepositOwner})`,
      );
      logger.debug(`${logPrefix} L1 Contract Funding Tx Arg:`, fundingTx);
      logger.debug(`${logPrefix} L1 Contract Reveal Arg:`, revealData);

      // Create the funding transaction array to match the contract expected format
      const fundingTxStruct = [
        fundingTx.version,
        fundingTx.inputVector,
        fundingTx.outputVector,
        fundingTx.locktime,
      ] as any;
      
      // Take the first 5 elements of the reveal array
      const revealArray = revealData.slice(0, 5) as any;

      const txResponse = await this.l1DepositorContract.initializeDeposit(
        fundingTxStruct,
        revealArray,
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
        await updateToInitializedDeposit(deposit, txReceipt);
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
    } catch (error: any) {
      const errorMsg = `Error checking deposit ${deposit.id} minting status on chain ${this.config.chainName}: ${error.message}`;
      logger.error(errorMsg, { error: logErrorContext(errorMsg, error) });
      logDepositError(deposit.id, errorMsg, error);
      return false;
    }
  }
}
