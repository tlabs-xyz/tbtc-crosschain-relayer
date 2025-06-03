import type { CommonChainConfigSchema } from '../schemas/common.schema.js';
import { z } from 'zod';
import { getEnv } from '../../utils/Env.js';

type CommonChainInput = z.input<typeof CommonChainConfigSchema>;

// =============================================================================
// SHARED tBTC PROTOCOL CONFIGURATION
// =============================================================================
// This file contains shared configuration patterns and constants used across
// multiple chain configurations to reduce duplication and ensure consistency.

// =============================================================================
// SHARED CONTRACT ADDRESSES
// =============================================================================

// TBTCVault address - SAME across all mainnet chains (deployed on Ethereum)
export const TBTC_VAULT_MAINNET = '0x9C070027cdC9dc8F82416B2e5314E11DFb4FE3CD';

// Note: Testnet vault addresses may differ - need research for Sepolia
export const TBTC_VAULT_TESTNET = '0x9C070027cdC9dc8F82416B2e5314E11DFb4FE3CD'; // TODO: Verify for testnet

// =============================================================================
// WORMHOLE CONFIGURATION CONSTANTS
// =============================================================================

// Wormhole Chain IDs (only verified ones we actually use)
export const WORMHOLE_CHAIN_IDS = {
  ARBITRUM_ONE: 23,
  BASE: 30,
  BASE_SEPOLIA: 10004,
  ARBITRUM_SEPOLIA: 10003, // needs verification
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
  'base-mainnet': 'https://base-mainnet.publicnode.com',
  'base-sepolia': 'https://base-sepolia.publicnode.com',
} as const;

// Public WebSocket endpoints
export const PUBLIC_WS_RPCS = {
  'arbitrum-one': 'wss://arbitrum-one.publicnode.com',
  'base-mainnet': 'wss://base-mainnet.publicnode.com',
  'base-sepolia': 'wss://base-sepolia.publicnode.com',
} as const;

// =============================================================================
// SHARED RPC URL BUILDERS
// =============================================================================

/**
 * Builds L1 (Ethereum) RPC URL with smart fallbacks
 * Priority: 1) Shared L1 env var, 2) Public fallback
 */
export const buildL1RpcUrl = (isTestnet = false): string => {
  const publicFallback = isTestnet
    ? 'https://ethereum-sepolia.rpc.grove.city/v1/62b3314e123e6f00424e5e75'
    : 'https://ethereum-mainnet.rpc.grove.city/v1/62b3314e123e6f00424e5e75';

  // Use shared L1 environment variables instead of chain-specific ones
  const sharedL1EnvVar = isTestnet ? 'ETHEREUM_SEPOLIA_RPC' : 'ETHEREUM_MAINNET_RPC';

  return getEnv(sharedL1EnvVar, publicFallback);
};

/**
 * Builds L2 (Target Network) RPC URL with smart fallbacks
 * Priority: 1) Environment override, 2) Public fallback
 */
export const buildL2RpcUrl = (
  envVarName: string,
  network: string,
  publicFallback: string,
): string => {
  return getEnv(envVarName, publicFallback);
};

/**
 * Builds L2 WebSocket URL with smart fallbacks
 * Priority: 1) Environment override, 2) Public fallback
 */
export const buildL2WsUrl = (
  envVarName: string,
  network: string,
  publicFallback: string,
): string => {
  return getEnv(envVarName, publicFallback);
};

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
  ENABLE_L2_REDEMPTION_MAINNET: true, // Enable minter functionality (mainnet)
  ENABLE_L2_REDEMPTION_TESTNET: true, // Enable minter functionality (testnet)
  ENABLE_L2_REDEMPTION_BACKUP: false, // Disable for backup instances
} as const;

// =============================================================================
// SEPOLIA TESTNET COMMON CONFIGURATION
// =============================================================================
// This is the original common configuration for Sepolia testnet
// TODO: Replace mock addresses with real testnet addresses

export const commonChainInput: CommonChainInput = {
  // tBTC Protocol Architecture for Sepolia Testnet:
  // L1 = Ethereum Sepolia (core tBTC protocol deployment - testnet)
  // L2 = Arbitrum Sepolia (minter functionality deployment - testnet)

  // L1 RPC: Ethereum Sepolia (core tBTC protocol layer - testnet)
  l1Rpc: buildL1RpcUrl(true),

  // L2 RPC: Arbitrum Sepolia (minter deployment layer - testnet)
  l2Rpc: 'https://sepolia.arbitrum.io/rpc',

  // L2 WebSocket: Arbitrum Sepolia (for real-time minter events - testnet)
  l2WsRpc: 'wss://sepolia.arbitrum.io/feed',

  // Environment variables - SENSITIVE VALUES ONLY
  privateKey: getEnv('CHAIN_SEPOLIATESTNET_PRIVATE_KEY'),

  // Block Configuration
  l2StartBlock: 100000, // Conservative testnet start block
  l1Confirmations: L1_CONFIRMATIONS.TESTNET, // Faster testnet confirmations

  // Contract Addresses - TODO: Replace with real testnet addresses
  // URGENT: These are MOCK addresses that will cause failures!
  l1ContractAddress: '0x1111111111111111111111111111111111111111', // MOCK - L1BitcoinDepositor on Ethereum Sepolia
  l2ContractAddress: '0x5555555555555555555555555555555555555555', // MOCK - L2BitcoinDepositor on Arbitrum Sepolia
  vaultAddress: TBTC_VAULT_TESTNET, // TODO: Verify testnet vault address

  // Wormhole Configuration - TODO: Replace with real testnet values
  l2WormholeGatewayAddress: '0x4444444444444444444444444444444444444444', // MOCK - Wormhole Gateway on Arbitrum Sepolia
  l2WormholeChainId: 10003, // Arbitrum Sepolia Wormhole Chain ID (needs verification)

  // Feature Flags - Testnet defaults
  useEndpoint: FEATURE_FLAGS.USE_ENDPOINT,
  enableL2Redemption: FEATURE_FLAGS.ENABLE_L2_REDEMPTION_TESTNET,
};

/*
 * URGENT TODO - SEPOLIA TESTNET CONFIGURATION:
 *
 * The commonChainInput configuration still contains MOCK addresses!
 * This needs to be updated with real Sepolia testnet addresses:
 *
 * REQUIRED RESEARCH:
 * 1. L1BitcoinDepositor address on Ethereum Sepolia
 * 2. L2BitcoinDepositor address on Arbitrum Sepolia
 * 3. TBTCVault address for Sepolia testnet (may be same as mainnet)
 * 4. Wormhole Gateway address on Arbitrum Sepolia
 * 5. Verify Wormhole Chain ID for Arbitrum Sepolia (10003)
 *
 * IMPACT: Any chains using commonChainInput will have non-functional addresses
 * PRIORITY: High - affects testnet functionality
 */
