/**
 * Database-related type utilities for tBTC Cross-Chain Relayer
 * These types improve type safety for Prisma operations and data serialization
 */

import type { Deposit } from './Deposit.type.js';

// Re-export ErrorLike from Error.types for backward compatibility
export type { ErrorLike } from './Error.types.js';

/**
 * Prisma where clause types for common queries
 */
export interface DepositWhereClause {
  status?: string;
  chainId?: string;
  id?: string;
  [key: string]: unknown;
}

export interface RedemptionWhereClause {
  status?: string;
  chainName?: string;
  id?: string;
  [key: string]: unknown;
}

/**
 * Serialized deposit data for Prisma storage
 */
export interface SerializedDepositData {
  id: string;
  chainId: string;
  status: string;
  hashes: Deposit['hashes'];
  receipt: Deposit['receipt'];
  L1OutputEvent: Deposit['L1OutputEvent'] | null;
  dates: Deposit['dates'];
  wormholeInfo: Deposit['wormholeInfo'];
  [key: string]: unknown;
}

/**
 * Serialized redemption data for Prisma storage
 */
export interface SerializedRedemptionData {
  id: string;
  chainName: string;
  status: string;
  data: Record<string, unknown>;
}

/**
 * Raw database record types as returned by Prisma
 */
export interface RawDepositRecord {
  id: string;
  chainId: string;
  status: string;
  hashes: unknown;
  receipt: unknown;
  L1OutputEvent: unknown;
  dates: unknown;
  wormholeInfo: unknown;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface RawRedemptionRecord {
  id: string;
  chainName: string;
  status: string;
  data: unknown;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Type for objects that can be safely JSON serialized
 */
export type JSONSerializable =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JSONSerializable }
  | JSONSerializable[];

/**
 * Type for data that needs BigNumber serialization handling
 */
export interface BigNumberAware {
  amount?: unknown; // Could be BigNumber or string
  txOutputValue?: unknown; // Could be BigNumber or string
  [key: string]: unknown;
}

/**
 * Helper type for database operation results
 */
export interface DatabaseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Type for batch operations
 */
export interface BatchDeleteResult {
  count: number;
  deletedIds: string[];
}
