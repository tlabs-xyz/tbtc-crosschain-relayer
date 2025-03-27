import { Deposit } from '../types/Deposit.type';
import { DepositStatus } from '../types/DepositStatus.enum';

/**
 * Interface for chain-specific handlers that define common functionality
 * across different blockchain implementations.
 */
export interface ChainHandlerInterface {
  /**
   * Initialize the chain handler with necessary connections and contracts
   */
  initialize(): Promise<void>;

  /**
   * Set up blockchain event listeners
   */
  setupListeners(): Promise<void>;

  /**
   * Initialize a deposit on the L1 chain
   * @param deposit The deposit to initialize
   */
  initializeDeposit(deposit: Deposit): Promise<void>;

  /**
   * Finalize a deposit on the L1 chain
   * @param deposit The deposit to finalize
   */
  finalizeDeposit(deposit: Deposit): Promise<void>;

  /**
   * Check the status of a deposit on the chain.
   * @param depositId The unique identifier of the deposit.
   * @returns The current status as a numeric enum value, or null if not found.
   */
  checkDepositStatus(depositId: string): Promise<DepositStatus | null>;

  /**
   * Get the latest block number from the chain
   */
  getLatestBlock(): Promise<number>;

  /**
   * Process deposits that should be initialized
   */
  processInitializeDeposits(): Promise<void>;

  /**
   * Process deposits that should be finalized
   */
  processFinalizeDeposits(): Promise<void>;

  /**
   * Check for past deposits that might have been missed
   * @param options Options for checking past deposits
   */
  checkForPastDeposits(options: {
    pastTimeInMinutes: number;
    latestBlock: number;
  }): Promise<void>;
}
