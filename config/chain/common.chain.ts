import type { CommonChainConfigSchema } from '../schemas/common.schema.js';
import { NETWORK } from '../schemas/common.schema.js';
import { z } from 'zod';
import { getEnv } from '../../utils/Env.js';

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
} as const;

export const L1_CONTRACT_ADDRESSES = {
  [NETWORK.MAINNET]: '0xC83A3EbC17F11F69F9782e50b017C8A53d72662A',
  [NETWORK.TESTNET]: '0x75A6e4A7C8fAa162192FAD6C1F7A6d48992c619A',
  [NETWORK.DEVNET]: '0x75A6e4A7C8fAa162192FAD6C1F7A6d48992c619A', // Assuming Devnet uses Testnet L1 contracts
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
  'ethereum-sepolia': 'https://sepolia.publicnode.com',
  'solana-devnet': 'https://api.devnet.solana.com',
} as const;

// Public WebSocket endpoints
export const PUBLIC_WS_RPCS = {
  'arbitrum-one': 'wss://arbitrum-one.publicnode.com',
  'arbitrum-sepolia': 'wss://sepolia.arbitrum.io/feed',
  'base-mainnet': 'wss://base-mainnet.publicnode.com',
  'base-sepolia': 'wss://base-sepolia.publicnode.com',
  'ethereum-sepolia': 'wss://sepolia.publicnode.com',
  'solana-devnet': 'wss://api.devnet.solana.com',
} as const;

// =============================================================================
// SHARED CONFIGURATION DEFAULTS
// =============================================================================

// Standard confirmation counts by network type
export const L1_CONFIRMATIONS = {
  MAINNET: 6, // Production security
  MAINNET_HIGH: 12, // Enhanced production security
  TESTNET: 3, // Faster testing
} as const;

// Common feature flags
export const FEATURE_FLAGS = {
  USE_ENDPOINT: false, // Use direct blockchain listeners (default)
  ENABLE_L2_REDEMPTION_MAINNET: true,
  ENABLE_L2_REDEMPTION_TESTNET: true,
};

// Default common values, intended to be shared primarily by MAINNET configurations.
// Specific configurations (including testnets) can override these.
export const commonChainInput: Partial<CommonChainInput> = {
  // Core network and L1 settings - typically common for mainnet deployments
  network: NETWORK.MAINNET,
  l1Rpc: getEnv('ETHEREUM_MAINNET_RPC'),
  vaultAddress: VAULT_ADDRESSES[NETWORK.MAINNET],
  l1Confirmations: L1_CONFIRMATIONS.MAINNET,
  l1ContractAddress: L1_CONTRACT_ADDRESSES[NETWORK.MAINNET],
  useEndpoint: FEATURE_FLAGS.USE_ENDPOINT,
  enableL2Redemption: FEATURE_FLAGS.ENABLE_L2_REDEMPTION_MAINNET,

  // Fields that were previously 'undefined as unknown as <type>' have been removed.
  // They are now expected to be explicitly defined in each specific chain configuration
  // that spreads commonChainInput (or a derivative of it).
  // Zod schemas will enforce their presence and correct type during config loading.
};
