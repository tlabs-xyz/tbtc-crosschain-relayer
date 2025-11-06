import type { CommonChainConfigSchema } from '../schemas/common.schema.js';
import { NETWORK } from '../schemas/common.schema.js';
import { z } from 'zod';
import { getEnv, getEnvBoolean } from '../../utils/Env.js';
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

// Sei-specific L1 Bitcoin depositor contract addresses (NTT with Executor pattern)
// These are ETHEREUM addresses (on Ethereum mainnet/Sepolia), NOT Sei addresses
// IMPORTANT: Only "Manager with Executor" supports Sei - plain Manager does NOT support Sei
// SDK Version: Updated to match L1BTCDepositorNttWithExecutor with bytes32 destinationChainDepositOwner
export const SEI_L1_CONTRACT_ADDRESSES = {
  [NETWORK.MAINNET]: '0xd2d9c936165a85f27a5a7e07afb974d022b89463', // L1BTCDepositorNttWithExecutor on Ethereum Mainnet (deployed at block 23570676)
  [NETWORK.TESTNET]: '0x54DD7080aE169DD923fE56d0C4f814a0a17B8f41', // L1BTCDepositorNttWithExecutor on Sepolia
  [NETWORK.DEVNET]: '0x0000000000000000000000000000000000000000', // Development environment - placeholder
} as const;

// Sei-specific L2 Token contract addresses (on Sei EVM)
// These are SEI EVM addresses (Sei EVM Chain ID: 1329 for mainnet, 1328 for testnet)
export const SEI_L2_TOKEN_ADDRESSES = {
  [NETWORK.MAINNET]: '0xF9201c9192249066Aec049ae7951ae298BBec767', // L2 TBTC token on Sei Mainnet (Pacific-1, Chain ID 1329)
  [NETWORK.TESTNET]: '0x0000000000000000000000000000000000000000', // L2 TBTC token on Sei Testnet (Atlantic-2, Chain ID 1328) - placeholder, update when deployed
  [NETWORK.DEVNET]: '0x0000000000000000000000000000000000000000', // Sei Development environment L2 token (placeholder)
} as const;

// =============================================================================
// WORMHOLE CONFIGURATION CONSTANTS
// =============================================================================

// General Wormhole Chain IDs - these may or may not map 1:1 to our internal chain IDs
// Ref: https://docs.wormhole.com/wormhole/reference/constants
// NOTE: These are Wormhole Chain IDs used for cross-chain messaging, NOT native blockchain chain IDs!
// Example: Sei has Wormhole Chain ID 40, but Sei EVM has native Chain ID 1329 (Pacific-1 mainnet) and 1328 (Atlantic-2 testnet)
export const WORMHOLE_CHAIN_IDS = {
  // EVM
  ARBITRUM_ONE: 23,
  BASE: 30,
  SEI: 40, // Wormhole Chain ID for Sei (NOT the same as Sei EVM Chain IDs: 1329 mainnet, 1328 testnet)
  // EVM Testnets/Devnets
  BASE_SEPOLIA: 10004,
  ARBITRUM_SEPOLIA: 10003,
  SEI_TESTNET: 40, // Sei uses same Wormhole ID (40) for mainnet and testnet
  // Non-EVM
  SOLANA: 1,
} as const;

// Wormhole Gateway Addresses (only verified ones)
export const WORMHOLE_GATEWAYS = {
  ARBITRUM_ONE: '0x1293a54e160D1cd7075487898d65266081A15458',
  ARBITRUM_SEPOLIA: '0xc3D46e0266d95215589DE639cC4E93b79f88fc6C',
  BASE: '0x09959798B95d00a3183d20FaC298E4594E599eab',
  BASE_SEPOLIA: '0xc3D46e0266d95215589DE639cC4E93b79f88fc6C',
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
  'sei-mainnet': 'https://evm-rpc.sei-apis.com', // Sei EVM RPC (native Chain ID: 1329 - Pacific-1)
  'sei-testnet': 'https://evm-rpc-testnet.sei-apis.com', // Sei EVM Testnet RPC (Atlantic-2)
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
  'sei-mainnet': 'wss://evm-ws.sei-apis.com', // Sei EVM WebSocket (native Chain ID: 1329 - Pacific-1)
  'sei-testnet': 'wss://evm-ws-testnet.sei-apis.com', // Sei EVM Testnet WebSocket (Atlantic-2)
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
  USE_ENDPOINT: getEnvBoolean('USE_ENDPOINT', true),
  ENABLE_L2_REDEMPTION_MAINNET: true,
  ENABLE_L2_REDEMPTION_TESTNET: true,
  ENABLE_L2_REDEMPTION_DEVNET: true,
};

/**
 * Returns a partial common chain input configuration for the given network.
 * Used to provide shared defaults and structure for EVM, Sui, and other chain configs.
 * Note: l1BitcoinDepositorAddress is not included here as each chain type should set it directly.
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
    l1Confirmations: l1ConfValue,
    enableL2Redemption:
      targetNetwork === NETWORK.MAINNET
        ? FEATURE_FLAGS.ENABLE_L2_REDEMPTION_MAINNET
        : targetNetwork === NETWORK.TESTNET
          ? FEATURE_FLAGS.ENABLE_L2_REDEMPTION_TESTNET
          : FEATURE_FLAGS.ENABLE_L2_REDEMPTION_DEVNET,
    depositApiEndpoint: process.env.DEPOSIT_API_ENDPOINT,
  };

  return commonInput;
};
