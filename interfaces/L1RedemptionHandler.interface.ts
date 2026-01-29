import type { AnyChainConfig } from '../config/index.js';
import type { BigNumber } from 'ethers';

/**
 * Success case - L1 relay completed successfully.
 * txHash is required and isRetryable is always false for success.
 *
 * @example
 * const success: L1RelaySuccess = {
 *   success: true,
 *   txHash: '0xabc123...',
 *   isRetryable: false
 * };
 */
interface L1RelaySuccess {
  /** Indicates the relay operation succeeded */
  success: true;
  /** L1 transaction hash - required on success */
  txHash: string;
  /** Always false for successful operations */
  isRetryable: false;
}

/**
 * Failure case - L1 relay failed.
 * error is required, txHash is optional (present for on-chain reverts).
 *
 * @example
 * // Retryable error (pending redemption collision)
 * const retryable: L1RelayFailure = {
 *   success: false,
 *   error: 'pending redemption',
 *   isRetryable: true
 * };
 *
 * @example
 * // Permanent error (VAA already used)
 * const permanent: L1RelayFailure = {
 *   success: false,
 *   error: 'VAA was already executed',
 *   isRetryable: false
 * };
 */
interface L1RelayFailure {
  /** Indicates the relay operation failed */
  success: false;
  /** Error message describing the failure - required on failure */
  error: string;
  /** Indicates if the error is transient and the operation should be retried */
  isRetryable: boolean;
  /** L1 transaction hash, may be present for on-chain reverts */
  txHash?: string;
}

/**
 * Result of an L1 relay operation for typed error propagation.
 * Uses discriminated union to enforce field presence based on success value:
 * - Success: txHash required, error not present, isRetryable always false
 * - Failure: error required, txHash optional, isRetryable indicates retry eligibility
 *
 * Type narrowing allows direct field access after checking success:
 * @example
 * if (result.success) {
 *   console.log(result.txHash); // TypeScript knows txHash is string
 * } else {
 *   console.log(result.error);  // TypeScript knows error is string
 * }
 */
export type L1RelayResult = L1RelaySuccess | L1RelayFailure;

/**
 * Interface for chain-specific handlers that define common functionality
 * across different blockchain implementations.
 */
export interface L1RedemptionHandlerInterface {
  config: AnyChainConfig;

  /**
   * Initialize the L1 redemption handler with necessary connections and contracts
   */
  initialize(): Promise<void>;

  /**
   * Relay a redemption to the L1 chain
   * @param amount - The redemption amount
   * @param signedVaa - The signed VAA from Wormhole
   * @param l2ChainName - The name of the L2 chain
   * @param l2TransactionHash - The L2 transaction hash
   * @param redeemerOutputScript - The Bitcoin redeemer output script for collision detection
   * @returns L1RelayResult with success status, txHash, error, and retry information
   */
  relayRedemptionToL1(
    amount: BigNumber,
    signedVaa: Uint8Array,
    l2ChainName: string,
    l2TransactionHash: string,
    redeemerOutputScript: string,
  ): Promise<L1RelayResult>;
}
