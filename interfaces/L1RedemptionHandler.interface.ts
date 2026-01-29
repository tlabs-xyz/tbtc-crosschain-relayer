import type { AnyChainConfig } from '../config/index.js';
import type { BigNumber } from 'ethers';

/**
 * Result of an L1 relay operation for typed error propagation.
 * Enables intelligent retry decisions by preserving error context.
 *
 * @example
 * // Success case
 * const success: L1RelayResult = {
 *   success: true,
 *   txHash: '0xabc123...',
 *   isRetryable: false
 * };
 *
 * @example
 * // Retryable error (pending redemption collision)
 * const retryable: L1RelayResult = {
 *   success: false,
 *   error: 'pending redemption',
 *   isRetryable: true
 * };
 *
 * @example
 * // Permanent error (VAA already used)
 * const permanent: L1RelayResult = {
 *   success: false,
 *   error: 'VAA was already executed',
 *   isRetryable: false
 * };
 */
export interface L1RelayResult {
  /** Whether the relay operation succeeded */
  success: boolean;
  /** L1 transaction hash, present only on successful relay */
  txHash?: string;
  /** Error message describing the failure, present only on failed relay */
  error?: string;
  /** Indicates if the error is transient and the operation should be retried */
  isRetryable: boolean;
}

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
