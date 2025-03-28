import { BigNumber, ethers } from 'ethers';
import { NonceManager } from '@ethersproject/experimental';

import { ChainHandlerInterface } from '../interfaces/ChainHandler.interface';
import { ChainConfig } from '../types/ChainConfig.type';
import { Deposit } from '../types/Deposit.type';
import { FundingTransaction } from '../types/FundingTransaction.type';
import { LogError, LogMessage, LogWarning } from '../utils/Logs';
import {
  getJsonById,
  getAllJsonOperationsByStatus,
  writeJson,
} from '../utils/JsonUtils';
import {
  createDeposit,
  updateToInitializedDeposit,
  updateToFinalizedDeposit,
  updateLastActivity,
  getBlocksByTimestamp,
  getDepositId,
} from '../utils/Deposits';
import { getFundingTxHash } from '../utils/GetTransactionHash';
import { DepositStatus } from '../types/DepositStatus.enum';

import { L1BitcoinDepositorABI } from '../interfaces/L1BitcoinDepositor';
import { L2BitcoinDepositorABI } from '../interfaces/L2BitcoinDepositor';
import { TBTCVaultABI } from '../interfaces/TBTCVault';
import {
  logDepositError,
} from '../utils/AuditLog';

export class EVMChainHandler implements ChainHandlerInterface {
  private l1Provider: ethers.providers.JsonRpcProvider;
  private l2Provider: ethers.providers.JsonRpcProvider;
  private l1Signer: ethers.Wallet;
  private l2Signer: ethers.Wallet;
  private nonceManagerL1: NonceManager;
  private nonceManagerL2: NonceManager;
  private l1BitcoinDepositor: ethers.Contract;
  private l2BitcoinDepositor: ethers.Contract;
  private tbtcVault: ethers.Contract;
  private l1BitcoinDepositorProvider: ethers.Contract;
  private l2BitcoinDepositorProvider: ethers.Contract;
  private tbtcVaultProvider: ethers.Contract;
  private config: ChainConfig;

  private readonly TIME_TO_RETRY = 1000 * 60 * 5; // 5 minutes

  constructor(config: ChainConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    LogMessage(`Initializing EVM chain handler for ${this.config.chainName}`);

    // Create providers
    this.l1Provider = new ethers.providers.JsonRpcProvider(this.config.l1Rpc);

    if (this.config.l2Rpc) {
      this.l2Provider = new ethers.providers.JsonRpcProvider(this.config.l2Rpc);
    }

    // Create signers
    this.l1Signer = new ethers.Wallet(this.config.privateKey, this.l1Provider);

    if (this.l2Provider) {
      this.l2Signer = new ethers.Wallet(
        this.config.privateKey,
        this.l2Provider
      );
    }

    // Create nonce managers
    this.nonceManagerL1 = new NonceManager(this.l1Signer);

    if (this.l2Signer) {
      this.nonceManagerL2 = new NonceManager(this.l2Signer);
    }

    // Create contract instances for transactions
    this.l1BitcoinDepositor = new ethers.Contract(
      this.config.l1ContractAddress,
      L1BitcoinDepositorABI,
      this.nonceManagerL1
    );

    if (this.config.l2ContractAddress && this.nonceManagerL2) {
      this.l2BitcoinDepositor = new ethers.Contract(
        this.config.l2ContractAddress,
        L2BitcoinDepositorABI,
        this.nonceManagerL2
      );
    }

    this.tbtcVault = new ethers.Contract(
      this.config.vaultAddress,
      TBTCVaultABI,
      this.l1Signer
    );

    // Create contract instances for event listening
    this.l1BitcoinDepositorProvider = new ethers.Contract(
      this.config.l1ContractAddress,
      L1BitcoinDepositorABI,
      this.l1Provider
    );

    if (this.l2Provider && this.config.l2ContractAddress) {
      this.l2BitcoinDepositorProvider = new ethers.Contract(
        this.config.l2ContractAddress,
        L2BitcoinDepositorABI,
        this.l2Provider
      );
    }

    this.tbtcVaultProvider = new ethers.Contract(
      this.config.vaultAddress,
      TBTCVaultABI,
      this.l1Provider
    );

    LogMessage(`EVM chain handler initialized for ${this.config.chainName}`);
  }

  async setupListeners(): Promise<void> {
    LogMessage(`Setting up event listeners for ${this.config.chainName}`);

    if (this.l2BitcoinDepositorProvider) {
      this.l2BitcoinDepositorProvider.on(
        'DepositInitialized',
        async (fundingTx, reveal, l2DepositOwner, l2Sender) => {
          try {
            LogMessage(
              `Received DepositInitialized event for Tx: ${fundingTx}`
            );
            const deposit: Deposit = createDeposit(
              fundingTx,
              reveal,
              l2DepositOwner,
              l2Sender
            );
            writeJson(deposit, deposit.id);
            LogMessage(`Initializing deposit | Id: ${deposit.id}`);
            await this.initializeDeposit(deposit);
          } catch (error) {
            LogMessage(`Error in DepositInitialized handler: ${error}`);
          }
        }
      );
    }

    this.tbtcVaultProvider.on(
      'OptimisticMintingFinalized',
      (minter, depositKey, depositor, optimisticMintingDebt) => {
        try {
          const BigDepositKey = BigNumber.from(depositKey);
          const deposit: Deposit | null = getJsonById(BigDepositKey.toString());
          if (deposit) this.finalizeDeposit(deposit);
        } catch (error) {
          LogMessage(
            `Error in the OptimisticMintingFinalized handler: ${error}`
          );
        }
      }
    );

    LogMessage(`Event listeners setup complete for ${this.config.chainName}`);
  }

  async initializeDeposit(deposit: Deposit): Promise<void> {
    try {
      LogMessage(`INITIALIZE | Pre-call checking... | ID: ${deposit.id}`);
      // Pre-call
      await this.l1BitcoinDepositor.callStatic.initializeDeposit(
        deposit.L1OutputEvent.fundingTx,
        deposit.L1OutputEvent.reveal,
        deposit.L1OutputEvent.l2DepositOwner
      );
      LogMessage(`INITIALIZE | Pre-call successful | ID: ${deposit.id}`);

      const currentNonce =
        await this.nonceManagerL1.getTransactionCount('latest');
      // Call
      const tx = await this.l1BitcoinDepositor.initializeDeposit(
        deposit.L1OutputEvent.fundingTx,
        deposit.L1OutputEvent.reveal,
        deposit.L1OutputEvent.l2DepositOwner,
        { nonce: currentNonce }
      );

      LogMessage(
        `INITIALIZE | Waiting to be mined | ID: ${deposit.id} | TxHash: ${tx.hash}`
      );
      // Wait for the transaction to be mined
      await tx.wait();
      LogMessage(
        `INITIALIZE | Transaction mined | ID: ${deposit.id} | TxHash: ${tx.hash}`
      );

      // Update the deposit status in the JSON storage
      updateToInitializedDeposit(deposit, tx);
    } catch (error: any) {
      const reason = error.reason ? error.reason : 'Unknown error';
      LogError(`INITIALIZE | ERROR | ID: ${deposit.id} | Reason: `, reason);
      logDepositError(deposit.id, `Failed to initialize deposit: ${reason}`, error);
      updateToInitializedDeposit(deposit, null, reason);
    }
  }

  async finalizeDeposit(deposit: Deposit): Promise<void> {
    try {
      LogMessage(`FINALIZE | Quoting fee... | ID: ${deposit.id}`);
      const value = (
        await this.l1BitcoinDepositor.quoteFinalizeDeposit()
      ).toString();
      LogMessage(`FINALIZE | Fee quoted: ${value} wei | ID: ${deposit.id}`);

      LogMessage(`FINALIZE | Pre-call checking... | ID: ${deposit.id}`);
      await this.l1BitcoinDepositor.callStatic.finalizeDeposit(deposit.id, {
        value: value,
      });
      LogMessage(`FINALIZE | Pre-call successful | ID: ${deposit.id}`);

      const currentNonce =
        await this.nonceManagerL1.getTransactionCount('latest');
      const tx = await this.l1BitcoinDepositor.finalizeDeposit(deposit.id, {
        value: value,
        nonce: currentNonce,
      });

      LogMessage(
        `FINALIZE | Waiting to be mined | ID: ${deposit.id} | TxHash: ${tx.hash}`
      );
      await tx.wait();
      LogMessage(
        `FINALIZE | Transaction mined | ID: ${deposit.id} | TxHash: ${tx.hash}`
      );

      updateToFinalizedDeposit(deposit, tx);

    } catch (error: any) {
      const reason = error.reason ? error.reason : 'Unknown error';

      if (reason === "Deposit not finalized by the bridge") {
        LogWarning(
          `FINALIZE | WAITING | ID: ${deposit.id} | Reason: ${reason}`
        );
        updateLastActivity(deposit);
      } else {
        LogError(
          `FINALIZE | ERROR | ID: ${deposit.id} | Reason: ${reason}`,
          error
        );
        logDepositError(deposit.id, `Failed to finalize deposit: ${reason}`, error);
        updateToFinalizedDeposit(deposit, null, reason);
      }
    }
  }

  async checkDepositStatus(depositId: string): Promise<number> {
    try {
      return await this.l1BitcoinDepositor.deposits(depositId);
    } catch (error) {
      LogError('Error fetching status', error as Error);
      return 0;
    }
  }

  async getLatestBlock(): Promise<number> {
    if (!this.l2Provider) return 0;
    const block = await this.l2Provider.getBlock('latest');
    return block.number;
  }

  async processInitializeDeposits(): Promise<void> {
    try {
      const queuedDeposits: Array<Deposit> = await getAllJsonOperationsByStatus(
        DepositStatus.QUEUED
      );
      if (queuedDeposits.length === 0) return;

      // Filter deposits that have more than 5 minutes since the last activity
      const filteredDeposits = this.filterDepositsActivityTime(queuedDeposits);
      if (filteredDeposits.length === 0) return;

      LogMessage(
        `INITIALIZE | To be processed: ${filteredDeposits.length} deposits`
      );

      for (const deposit of filteredDeposits) {
        // Update the last activity timestamp of the deposit
        const updatedDeposit = updateLastActivity(deposit);

        // Check the status of the deposit in the contract
        const status = await this.checkDepositStatus(updatedDeposit.id);
        LogMessage(`L1BitcoinDepositor status | STATUS: ${status}`);

        switch (status) {
          case DepositStatus.INITIALIZED:
            await updateToInitializedDeposit(
              updatedDeposit,
              'Deposit already initialized'
            );
            break;

          case DepositStatus.QUEUED:
            await this.initializeDeposit(updatedDeposit);
            break;

          case DepositStatus.FINALIZED:
            await updateToFinalizedDeposit(
              updatedDeposit,
              'Deposit already finalized'
            );
            break;

          default:
            LogMessage(`Unhandled deposit status: ${status}`);
            break;
        }
      }
    } catch (error) {
      LogError('Error in processInitializeDeposits:', error as Error);
      logDepositError('batch-initialize', 'Error processing initialize batch', error);
    }
  }

  async processFinalizeDeposits(): Promise<void> {
    try {
      const initializedDeposits: Array<Deposit> =
        await getAllJsonOperationsByStatus(DepositStatus.INITIALIZED);
      if (initializedDeposits.length === 0) return;

      // Filter deposits that have more than 5 minutes since the last activity
      const filteredDeposits =
        this.filterDepositsActivityTime(initializedDeposits);
      if (filteredDeposits.length === 0) return;

      LogMessage(
        `FINALIZE | To be processed: ${filteredDeposits.length} deposits`
      );

      for (const deposit of filteredDeposits) {
        // Update the last activity timestamp of the deposit
        const updatedDeposit = updateLastActivity(deposit);

        // Check the status of the deposit in the contract
        const status = await this.checkDepositStatus(updatedDeposit.id);
        LogMessage(`L1BitcoinDepositor status | STATUS: ${status}`);

        switch (status) {
          case DepositStatus.INITIALIZED:
            // Try to finalize
            await this.finalizeDeposit(updatedDeposit);
            break;

          case DepositStatus.FINALIZED:
            await updateToFinalizedDeposit(
              updatedDeposit,
              'Deposit already finalized'
            );
            break;

          default:
            LogMessage(`Unhandled deposit status: ${status}`);
            break;
        }
      }
    } catch (error) {
      LogError('Error in processFinalizeDeposits:', error as Error);
      logDepositError('batch-finalize', 'Error processing finalize batch', error);
    }
  }

  async checkForPastDeposits(options: {
    pastTimeInMinutes: number;
    latestBlock: number;
  }): Promise<void> {
    LogMessage('Checking missed initializeDeposit transactions');
    try {
      const currentTime = Math.floor(Date.now() / 1000);
      const pastTime = currentTime - options.pastTimeInMinutes * 60;
      const { startBlock, endBlock } = await getBlocksByTimestamp(
        pastTime,
        options.latestBlock
      );

      if (!this.l2BitcoinDepositorProvider) {
        LogMessage(
          'No L2BitcoinDepositor provider configured, skipping past deposits check'
        );
        return;
      }

      const events = await this.l2BitcoinDepositorProvider.queryFilter(
        this.l2BitcoinDepositorProvider.filters.DepositInitialized(),
        startBlock,
        endBlock
      );

      if (events.length > 0) {
        LogMessage(
          `Found ${events.length} DepositInitialized events in the past`
        );

        for (const event of events) {
          if (!event.args) {
            LogMessage('Event args are undefined, skipping event');
            continue;
          }

          const { fundingTx, reveal, l2DepositOwner, l2Sender } = event.args;

          const fundingTxHash = getFundingTxHash(
            fundingTx as FundingTransaction
          );
          const depositId = getDepositId(fundingTxHash, reveal[0]);

          const existingDeposit = getJsonById(depositId);

          if (!existingDeposit) {
            LogMessage(`Processing missed deposit event: ${depositId}`);

            const newDeposit = createDeposit(
              fundingTx,
              reveal,
              l2DepositOwner,
              l2Sender
            );

            writeJson(newDeposit, newDeposit.id);

            await this.initializeDeposit(newDeposit);
          }
        }
      } else {
        LogMessage('No missed deposit events found');
      }
    } catch (error) {
      LogError('Error checking past deposits:', error as Error);
    }
  }

  // Helper methods
  private filterDepositsActivityTime(deposits: Array<Deposit>): Array<Deposit> {
    const now = Date.now();
    return deposits.filter((deposit) => {
      return now - deposit.dates.lastActivityAt > this.TIME_TO_RETRY;
    });
  }
}
