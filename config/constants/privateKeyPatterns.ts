/**
 * Shared private key validation patterns for all chain types
 * Used by both SecretUtils and schema validation to ensure consistency
 */

import { CHAIN_TYPE } from '../schemas/common.schema.js';

/**
 * Validation patterns for private keys by chain type
 */
export const PRIVATE_KEY_PATTERNS: Record<string, { pattern: RegExp; description: string }> = {
  [CHAIN_TYPE.EVM]: {
    pattern: /^(0x)?[0-9a-fA-F]{64}$/,
    description: '64 hex characters, optionally 0x-prefixed (secp256k1 private key)',
  },
  [CHAIN_TYPE.SOLANA]: {
    pattern: /^[1-9A-HJ-NP-Za-km-z]{43,44}$/,
    description: 'Base58 encoded Ed25519 private key (43-44 characters)',
  },
  [CHAIN_TYPE.STARKNET]: {
    pattern: /^0x[a-fA-F0-9]{1,63}$/,
    description: 'Hex string with 0x prefix (1-63 hex characters)',
  },
  [CHAIN_TYPE.SUI]: {
    pattern: /^[A-Za-z0-9+/=]{44,88}$/,
    description: 'Base64 encoded Ed25519 private key',
  },
};

/**
 * Get validation pattern for a specific chain type
 */
export function getPrivateKeyPattern(chainType: CHAIN_TYPE): {
  pattern: RegExp;
  description: string;
} | null {
  return PRIVATE_KEY_PATTERNS[chainType] || null;
}

/**
 * Check if a chain type has a validation pattern
 */
export function hasPrivateKeyPattern(chainType: string): chainType is CHAIN_TYPE {
  return chainType in PRIVATE_KEY_PATTERNS;
}
