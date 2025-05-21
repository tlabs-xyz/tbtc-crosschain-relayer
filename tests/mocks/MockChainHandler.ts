import type { TransactionReceipt } from '@ethersproject/providers';
import type { ChainHandlerInterface } from '../../interfaces/ChainHandler.interface.js';
import { DepositStatus } from '../../types/DepositStatus.enum.js';
import type { Deposit } from '../../types/Deposit.type.js';
import logger from '../../utils/Logger.js';
import { createTestDeposit } from './BlockchainMock.js';
import { BigNumber, ethers } from 'ethers';
import type { AnyChainConfig } from '../../config/index.js';
import { CHAIN_TYPE, NETWORK } from '../../config/schemas/chain.common.schema.js';

const mockReceipt = {
  to: '0x0000000000000000000000000000000000000000',
  from: '0x0000000000000000000000000000000000000000',
  contractAddress: '0x0000000000000000000000000000000000000000',
  transactionIndex: 0,
  gasUsed: BigNumber.from(21_000),
  logsBloom: '0x' + '0'.repeat(512),
  blockHash: '0x' + '0'.repeat(64),
  transactionHash: '0x' + '0'.repeat(64),
  logs: [],
  blockNumber: 1,
  cumulativeGasUsed: BigNumber.from(21_000),
  confirmations: 1,
  effectiveGasPrice: BigNumber.from(1),
  type: 2,
  status: 1,
  byzantium: true,
};

/**
 * Mock chain handler for testing
 */
export class MockChainHandler implements ChainHandlerInterface {
  public config: AnyChainConfig;
  private initialized: boolean = false;
  private deposits: Map<string, Deposit> = new Map();
  private listeners: Map<string, ((...args: any[]) => void)[]> = new Map();
  private processingDelayMs: number = 100; // Simulate processing delay

  constructor(config?: Partial<AnyChainConfig>) {
    // Initialize with test deposits
    this.addTestDeposits();
    // Default mock config
    // Ensure this default config satisfies the AnyChainConfig type requirements.
    // This might require casting or providing defaults for all discriminated union members.
    // For simplicity, we'll assume a base EVM-like structure for the mock.
    this.config = {
      chainName: config?.chainName ?? 'MockChain',
      chainType: config?.chainType ?? CHAIN_TYPE.EVM,
      network: config?.network ?? NETWORK.TESTNET,
      l1Rpc: config?.l1Rpc ?? 'http://localhost:8545',
      l1ContractAddress: config?.l1ContractAddress ?? ethers.constants.AddressZero,
      l1BitcoinRedeemerAddress: config?.l1BitcoinRedeemerAddress ?? ethers.constants.AddressZero,
      l2BitcoinRedeemerAddress: config?.l2BitcoinRedeemerAddress ?? ethers.constants.AddressZero,
      l2WormholeGatewayAddress: config?.l2WormholeGatewayAddress ?? ethers.constants.AddressZero,
      l2WormholeChainId: config?.l2WormholeChainId ?? 0,
      vaultAddress: config?.vaultAddress ?? ethers.constants.AddressZero,
      privateKey: config?.privateKey ?? ethers.Wallet.createRandom().privateKey,
      l2Rpc: config?.l2Rpc ?? 'http://localhost:8546', // Default for EVM L2
      useEndpoint: config?.useEndpoint ?? false,
      l2ContractAddress: config?.l2ContractAddress ?? ethers.constants.AddressZero,
      // Add Solana specific fields with defaults if chainType could be SOLANA
      // solanaPrivateKey: (config as any)?.solanaPrivateKey ?? '',
      // solanaCommitment: (config as any)?.solanaCommitment ?? 'confirmed',
      ...(config ?? {}),
    } as AnyChainConfig; // Type assertion might be needed if defaults don't fully satisfy
  }

  /**
   * Add some test deposits for testing
   */
  private addTestDeposits(): void {
    // Add a queued deposit
    const queuedDeposit = createTestDeposit({
      status: 'QUEUED',
    }) as Deposit;
    this.deposits.set(queuedDeposit.id, queuedDeposit);

    // Add an initialized deposit
    const initializedDeposit = createTestDeposit({
      status: 'INITIALIZED',
      hashes: {
        btc: {
          btcTxHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        },
        eth: {
          initializeTxHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
          finalizeTxHash: null,
        },
      },
      dates: {
        createdAt: Date.now() - 3600 * 1000, // 1 hour ago
        initializationAt: Date.now() - 1800 * 1000, // 30 mins ago
        finalizationAt: null,
        lastActivityAt: Date.now() - 1800 * 1000, // 30 mins ago
      },
    }) as Deposit;
    this.deposits.set(initializedDeposit.id, initializedDeposit);

    // Add a finalized deposit
    const finalizedDeposit = createTestDeposit({
      status: 'FINALIZED',
      hashes: {
        btc: {
          btcTxHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        },
        eth: {
          initializeTxHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
          finalizeTxHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        },
      },
      dates: {
        createdAt: Date.now() - 7200 * 1000, // 2 hours ago
        initializationAt: Date.now() - 5400 * 1000, // 1.5 hours ago
        finalizationAt: Date.now() - 3600 * 1000, // 1 hour ago
        lastActivityAt: Date.now() - 3600 * 1000, // 1 hour ago
      },
    }) as Deposit;
    this.deposits.set(finalizedDeposit.id, finalizedDeposit);
  }

  /**
   * Initialize the chain handler
   */
  async initialize(): Promise<void> {
    logger.info('MockChainHandler: Initializing...');
    // Simulate async initialization
    await new Promise((resolve) => setTimeout(resolve, 100));
    logger.info('MockChainHandler: Initialized.');
  }

  /**
   * Set up event listeners
   */
  async setupListeners(): Promise<void> {
    logger.info('MockChainHandler: Setting up listeners...');
    // Simulate listener setup
    await new Promise((resolve) => setTimeout(resolve, 100));
    logger.info('MockChainHandler: Listeners set up.');
  }

  /**
   * Get the latest block
   */
  async getLatestBlock(): Promise<number> {
    logger.info('MockChainHandler: Getting latest block...');
    return Promise.resolve(12345); // Mock block number
  }

  /**
   * Check for past deposits
   */
  async checkForPastDeposits(options: {
    pastTimeInMinutes: number;
    latestBlock: number;
  }): Promise<void> {
    logger.info(
      `MockChainHandler: Checking for past deposits (last ${options.pastTimeInMinutes} min, latest block ${options.latestBlock})`,
    );
    // Simulate checking
    await new Promise((resolve) => setTimeout(resolve, 100));
    logger.info('MockChainHandler: Past deposits check complete.');
  }

  /**
   * Initialize a deposit
   */
  async initializeDeposit(deposit: Deposit): Promise<TransactionReceipt | undefined> {
    logger.info(`Mock chain handler: Initializing deposit ${deposit.id}`);

    // Simulate processing delay
    await new Promise((resolve) => setTimeout(resolve, this.processingDelayMs));
    logger.info(`MockChainHandler: Deposit ${deposit.id} initialized.`);

    // Update deposit status
    if (deposit.status === DepositStatus.QUEUED) {
      const updatedDeposit = {
        ...deposit,
        status: DepositStatus.INITIALIZED,
        hashes: {
          ...deposit.hashes,
          eth: {
            ...deposit.hashes.eth,
            initializeTxHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
          },
        },
        dates: {
          ...deposit.dates,
          initializationAt: Date.now(),
          lastActivityAt: Date.now(),
        },
      } as Deposit;

      this.deposits.set(deposit.id, updatedDeposit);

      // Emit initialized event if listeners are set up
      this.emitEvent('DepositInitialized', deposit.id);
      return mockReceipt;
    }
  }

  /**
   * Finalize a deposit
   */
  async finalizeDeposit(deposit: Deposit): Promise<TransactionReceipt | undefined> {
    logger.info(`Mock chain handler: Finalizing deposit ${deposit.id}`);

    // Simulate processing delay
    await new Promise((resolve) => setTimeout(resolve, this.processingDelayMs));
    logger.info(`MockChainHandler: Deposit ${deposit.id} finalized.`);

    // Update deposit status
    if (deposit.status === DepositStatus.INITIALIZED) {
      const updatedDeposit = {
        ...deposit,
        status: DepositStatus.FINALIZED,
        hashes: {
          ...deposit.hashes,
          eth: {
            ...deposit.hashes.eth,
            finalizeTxHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
          },
        },
        dates: {
          ...deposit.dates,
          finalizationAt: Date.now(),
          lastActivityAt: Date.now(),
        },
      } as Deposit;
      this.deposits.set(deposit.id, updatedDeposit);

      // Emit finalized event if listeners are set up
      this.emitEvent('DepositFinalized', deposit.id);
      return mockReceipt;
    }
  }

  /**
   * Process deposits for initialization
   */
  async processInitializeDeposits(): Promise<void> {
    logger.info('MockChainHandler: Processing initialize deposits...');
    for (const deposit of this.deposits.values()) {
      if (deposit.status === DepositStatus.QUEUED) {
        await this.initializeDeposit(deposit);
      }
    }
    logger.info('MockChainHandler: Initialize deposits processing complete.');
  }

  /**
   * Process deposits for finalization
   */
  async processFinalizeDeposits(): Promise<void> {
    logger.info('MockChainHandler: Processing finalize deposits...');
    for (const deposit of this.deposits.values()) {
      if (deposit.status === DepositStatus.INITIALIZED) {
        await this.finalizeDeposit(deposit);
      }
    }
    logger.info('MockChainHandler: Finalize deposits processing complete.');
  }

  /**
   * Check deposit status
   */
  async checkDepositStatus(depositId: string): Promise<DepositStatus | null> {
    logger.info(`MockChainHandler: Checking status for deposit ${depositId}`);
    const deposit = this.deposits.get(depositId);
    return deposit ? deposit.status : null;
  }

  /**
   * Add a new test deposit
   */
  addDeposit(deposit: Deposit): void {
    logger.info(`MockChainHandler: Adding deposit ${deposit.id}`);
    this.deposits.set(deposit.id, deposit);
  }

  /**
   * Get a deposit by ID
   */
  getDeposit(depositId: string): Deposit | undefined {
    logger.info(`MockChainHandler: Getting deposit ${depositId}`);
    return this.deposits.get(depositId);
  }

  /**
   * Get all deposits
   */
  getAllDeposits(): Deposit[] {
    logger.info('MockChainHandler: Getting all deposits');
    return Array.from(this.deposits.values());
  }

  /**
   * Register event listener
   */
  on(event: string, listener: (...args: any[]) => void): void {
    logger.info(`MockChainHandler: Registering listener for event ${event}`);
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)?.push(listener);
  }

  /**
   * Remove event listener
   */
  off(event: string, listener: (...args: any[]) => void): void {
    logger.info(`MockChainHandler: Unregistering listener for event ${event}`);
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      const index = eventListeners.indexOf(listener);
      if (index > -1) {
        eventListeners.splice(index, 1);
      }
    }
  }

  /**
   * Emit event
   */
  private emitEvent(event: string, ...args: any[]): void {
    logger.info(`MockChainHandler: Emitting event ${event} with args:`, args);
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach((listener) => {
        try {
          listener(...args);
        } catch (error) {
          logger.error(`Error in listener for event ${event}:`, error);
        }
      });
    }
  }

  /**
   * Set processing delay
   */
  setProcessingDelay(delayMs: number): void {
    logger.info(`MockChainHandler: Setting processing delay to ${delayMs}ms`);
    this.processingDelayMs = delayMs;
  }

  /**
   * Indicates whether the mock handler supports checking for past deposits.
   * For testing, we can make this configurable or default to true/false.
   * Let's default to true for now, assuming tests might need it.
   */
  supportsPastDepositCheck(): boolean {
    logger.info('MockChainHandler: supportsPastDepositCheck called');
    return true; // Mock supports this
  }
}
