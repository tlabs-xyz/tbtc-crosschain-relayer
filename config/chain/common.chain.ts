import type { CommonChainConfigSchema } from '../schemas/common.schema.js';
import { NETWORK } from '../schemas/common.schema.js';
import { z } from 'zod';
import { getEnv } from '../../utils/Env.js';
// Re-export for convenience
export type { CommonChainInput } from '../schemas/common.schema.js';

type CommonChainInput = z.input<typeof CommonChainConfigSchema>;

// =============================================================================
// SHARED tBTC PROTOCOL CONFIGURATION
// =============================================================================
// This file contains shared configuration patterns and constants used across
// multiple chain configurations to reduce duplication and ensure consistency.

// Vault Addresses by network type
export const VAULT_ADDRESSES = {
  [NETWORK.MAINNET]: '0x9C070027cdC9dc8F82416B2e5314E11DFb4FE3CD',
  [NETWORK.TESTNET]: '0x9C070027cdC9dc8F82416B2e5314E11DFb4FE3CD',
  [NETWORK.DEVNET]: '0x9C070027cdC9dc8F82416B2e5314E11DFb4FE3CD',
} as const;

export const L1_CONTRACT_ADDRESSES = {
  [NETWORK.MAINNET]: '0xF462413315Ee37AEBD0f5cA4296D9F3F3D9C4A59',
  [NETWORK.TESTNET]: '0xF462413315Ee37AEBD0f5cA4296D9F3F3D9C4A59',
  [NETWORK.DEVNET]: '0xF462413315Ee37AEBD0f5cA4296D9F3F3D9C4A59',
} as const;

// =============================================================================
// WORMHOLE CONFIGURATION CONSTANTS
// =============================================================================

// General Wormhole Chain IDs - these may or may not map 1:1 to our internal chain IDs
// Ref: https://docs.wormhole.com/wormhole/reference/constants
export const WORMHOLE_CHAIN_IDS = {
  // EVM
  ARBITRUM_ONE: 23,
  BASE: 30,
  // EVM Testnets/Devnets
  BASE_SEPOLIA: 10004, // Arbitrum Sepolia Wormhole Chain ID (Testnet)
  ARBITRUM_SEPOLIA: 10003, // Verified: https://docs.wormhole.com/wormhole/reference/constants#testnet -> arbitrum-sepolia
  // Non-EVM
  SOLANA: 1,
} as const;

// Wormhole Gateway Addresses (only verified ones)
export const WORMHOLE_GATEWAYS = {
  ARBITRUM_ONE: '0x0b2402144Bb366A632D14B83F244D2e0e21bD39c',
  BASE: '0x8d2de8d2f73F1F4cAB472AC9A881C9b123C79627',
  BASE_SEPOLIA: '0x86F55A04690fd7815A3D802bD587e83eA888B239',
} as const;

// =============================================================================
// PUBLIC RPC ENDPOINT CONSTANTS
// =============================================================================

// Public RPC endpoints (HTTP)
export const PUBLIC_RPCS = {
  'arbitrum-one': 'https://arbitrum-one.publicnode.com',
  'arbitrum-sepolia': 'https://sepolia.arbitrum.io/rpc',
  'base-mainnet': 'https://base-mainnet.publicnode.com',
  'base-sepolia': 'https://base-sepolia.publicnode.com',
  'ethereum-mainnet': 'https://mainnet.publicnode.com',
  'ethereum-sepolia': 'https://sepolia.publicnode.com',
  'solana-devnet': 'https://api.devnet.solana.com',
} as const;

// Public WebSocket endpoints
export const PUBLIC_WS_RPCS = {
  'arbitrum-one': 'wss://arbitrum-one.publicnode.com',
  'arbitrum-sepolia': 'wss://sepolia.arbitrum.io/feed',
  'base-mainnet': 'wss://base-mainnet.publicnode.com',
  'base-sepolia': 'wss://base-sepolia.publicnode.com',
  'ethereum-mainnet': 'wss://mainnet.publicnode.com',
  'ethereum-sepolia': 'wss://sepolia.publicnode.com',
  'solana-devnet': 'wss://api.devnet.solana.com',
} as const;

// =============================================================================
// SHARED CONFIGURATION DEFAULTS
// =============================================================================

// Standard confirmation counts by network type
export const L1_CONFIRMATIONS = {
  [NETWORK.MAINNET]: 6,
  [NETWORK.TESTNET]: 3,
  [NETWORK.DEVNET]: 3,
} as const;

// Common feature flags
export const FEATURE_FLAGS = {
  USE_ENDPOINT: false,
  ENABLE_L2_REDEMPTION_MAINNET: true,
  ENABLE_L2_REDEMPTION_TESTNET: true,
  ENABLE_L2_REDEMPTION_DEVNET: true,
};

/**
 * Returns a partial common chain input configuration for the given network.
 * Used to provide shared defaults and structure for EVM, Sui, and other chain configs.
 * @param targetNetwork The network to generate config for (mainnet, testnet, devnet)
 * @returns Partial<CommonChainInput> with shared defaults
 */
export const getCommonChainInput = (targetNetwork: NETWORK): Partial<CommonChainInput> => {
  const l1ConfValue = L1_CONFIRMATIONS[targetNetwork] ?? L1_CONFIRMATIONS[NETWORK.TESTNET];

  const commonInput: Partial<CommonChainInput> = {
    network: targetNetwork,
    useEndpoint: FEATURE_FLAGS.USE_ENDPOINT,
    l1Rpc:
      targetNetwork === NETWORK.MAINNET
        ? getEnv('ETHEREUM_MAINNET_RPC', PUBLIC_RPCS['ethereum-mainnet'])
        : getEnv('ETHEREUM_SEPOLIA_RPC', PUBLIC_RPCS['ethereum-sepolia']),
    vaultAddress: VAULT_ADDRESSES[targetNetwork] || VAULT_ADDRESSES[NETWORK.TESTNET],
    l1ContractAddress:
      L1_CONTRACT_ADDRESSES[targetNetwork] || L1_CONTRACT_ADDRESSES[NETWORK.TESTNET],
    l1Confirmations: l1ConfValue,
    enableL2Redemption:
      targetNetwork === NETWORK.MAINNET
        ? FEATURE_FLAGS.ENABLE_L2_REDEMPTION_MAINNET
        : targetNetwork === NETWORK.TESTNET
          ? FEATURE_FLAGS.ENABLE_L2_REDEMPTION_TESTNET
          : FEATURE_FLAGS.ENABLE_L2_REDEMPTION_DEVNET,
  };

  return commonInput;
};
