/**
 * Shared Zod schemas and types for address and hex string validation.
 *
 * This file provides reusable validation logic for Ethereum addresses and generic hex strings,
 * ensuring type safety and consistent error messages across the codebase.
 */
import { z } from 'zod';

// =====================
// Shared Schemas & Types
// =====================

/**
 * Shared configuration fields and types for all chain schemas.
 * Includes common fields such as chainName, rpcUrl, and explorerUrl.
 */

/**
 * Zod schema for validating Ethereum addresses (0x-prefixed, 40 hex chars).
 */
export const EthereumAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');

/**
 * Type representing a valid Ethereum address.
 */
export type EthereumAddress = z.infer<typeof EthereumAddressSchema>;

// Added HexStringSchema
/**
 * Zod schema for validating generic hex strings (0x-prefixed, any length > 0).
 */
export const HexStringSchema = z
  .string()
  .regex(
    /^0x[a-fA-F0-9]+$/,
    'Invalid hex string (must start with 0x and be followed by hex characters)',
  );

/**
 * Type representing a valid hex string.
 */
export type HexString = z.infer<typeof HexStringSchema>;
