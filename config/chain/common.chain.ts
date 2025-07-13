import type { CommonChainConfigSchema } from '../schemas/common.schema.js';
import { NETWORK } from '../schemas/common.schema.js';
import { z } from 'zod';
import { getEnv, getEnvBoolean } from '../../utils/Env.js';
import { EndpointConfigurationFactory } from '../endpoint/EndpointConfiguration.js';
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
  [NETWORK.MAINNET]: '0x9C070027cdC9dc8F82416B2e5314E11DFb4FE3CD', // Mainnet vault address - verify before production deployment
  [NETWORK.TESTNET]: '0xB5679dE944A79732A75CE556191DF11F489448d5',
  [NETWORK.DEVNET]: '0xB5679dE944A79732A75CE556191DF11F489448d5',
} as const;

// StarkNet-specific L1 Bitcoin depositor contract addresses
export const STARKNET_L1_CONTRACT_ADDRESSES = {
  [NETWORK.MAINNET]: '0xC9031f76006da0BD4bFa9E02aDf0d448dB3BC155', // StarkNet Mainnet L1 depositor
  [NETWORK.TESTNET]: '0x40c74a5f0b0e6CC3Ae4E8dD2Db46d372504445DA', // StarkNet Sepolia testnet L1 depositor
  [NETWORK.DEVNET]: '0x40c74a5f0b0e6CC3Ae4E8dD2Db46d372504445DA', // StarkNet Development environment L1 depositor
} as const;

// Sui-specific L1 Bitcoin depositor contract addresses
export const SUI_L1_CONTRACT_ADDRESSES = {
  [NETWORK.MAINNET]: '0xb810AbD43d8FCFD812d6FEB14fefc236E92a341A', // Sui Mainnet L1 depositor (placeholder - update with actual address)
  [NETWORK.TESTNET]: '0x25b614064293A6B9012E82Bb31BC2B1Be34e36Cb', // Sui Testnet L1 depositor (placeholder - update with actual address)
  [NETWORK.DEVNET]: '0x25b614064293A6B9012E82Bb31BC2B1Be34e36Cb', // Sui Development environment L1 depositor (placeholder - update with actual address)
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
  BASE_SEPOLIA: 10004,
  ARBITRUM_SEPOLIA: 10003,
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
  ENABLE_L2_REDEMPTION_MAINNET: true,
  ENABLE_L2_REDEMPTION_TESTNET: true,
  ENABLE_L2_REDEMPTION_DEVNET: true,
};

/**
 * Returns a partial common chain input configuration for the given network.
 * Used to provide shared defaults and structure for EVM, Sui, and other chain configs.
 * Note: l1ContractAddress is not included here as each chain type should set it directly.
 * @param targetNetwork The network to generate config for (mainnet, testnet, devnet)
 * @param chainName Chain name for endpoint configuration
 * @param endpointOverrides Optional endpoint configuration overrides
 * @returns Partial<CommonChainInput> with shared defaults and standardized endpoint config
 */
export const getCommonChainInput = (
  targetNetwork: NETWORK,
  chainName?: string,
  endpointOverrides?: {
    useEndpoint?: boolean;
    endpointUrl?: string;
    supportsRevealDepositAPI?: boolean;
  },
): Partial<CommonChainInput> => {
  const l1ConfValue = L1_CONFIRMATIONS[targetNetwork] ?? L1_CONFIRMATIONS[NETWORK.TESTNET];

  // Create standardized endpoint configuration with migration support
  const endpointConfig = EndpointConfigurationFactory.create(
    chainName || 'unknown',
    endpointOverrides,
  );

  const commonInput: Partial<CommonChainInput> = {
    network: targetNetwork,
    useEndpoint: endpointConfig.useEndpoint,
    endpointUrl: endpointConfig.endpointUrl,
    supportsRevealDepositAPI: endpointConfig.supportsRevealDepositAPI,
    l1Rpc:
      targetNetwork === NETWORK.MAINNET
        ? getEnv('ETHEREUM_MAINNET_RPC', PUBLIC_RPCS['ethereum-mainnet'])
        : getEnv('ETHEREUM_SEPOLIA_RPC', PUBLIC_RPCS['ethereum-sepolia']),
    vaultAddress: VAULT_ADDRESSES[targetNetwork] || VAULT_ADDRESSES[NETWORK.TESTNET],
    l1Confirmations: l1ConfValue,
    enableL2Redemption:
      targetNetwork === NETWORK.MAINNET
        ? FEATURE_FLAGS.ENABLE_L2_REDEMPTION_MAINNET
        : targetNetwork === NETWORK.TESTNET
          ? FEATURE_FLAGS.ENABLE_L2_REDEMPTION_TESTNET
          : FEATURE_FLAGS.ENABLE_L2_REDEMPTION_DEVNET,
    l1StartBlock: Number(getEnv('L1_START_BLOCK', '0')),
    l2StartBlock: Number(getEnv('L2_START_BLOCK', '0')),
    useWormhole: getEnvBoolean('USE_WORMHOLE', false),
    depositApiEndpoint: process.env.DEPOSIT_API_ENDPOINT,
  };

  return commonInput;
};
