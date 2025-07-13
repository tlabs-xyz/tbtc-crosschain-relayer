/**
 * Chain Configuration System Exports
 *
 * This simplified export structure follows 12-factor app principles:
 * - Configuration is loaded from environment variables through input functions
 * - No complex factory patterns or abstractions
 * - Direct, easy-to-understand chain configurations via registry
 */

// Re-export the chain registry and types for backward compatibility
export { chainSchemaRegistry } from '../chainRegistry.js';
export type {
  EvmChainConfig,
  SolanaChainConfig,
  StarknetChainConfig,
  SuiChainConfig,
} from '../chainRegistry.js';

// Re-export input functions for direct use
export { getSepoliaTestnetChainInput } from './sepolia.chain.js';
export { getSolanaDevnetChainInput } from './solana.chain.js';
export { getStarknetTestnetChainInput } from './starknet.chain.js';
export { getStarknetMainnetChainInput } from './starknetMainnet.chain.js';
export { getSuiMainnetChainInput } from './sui.chain.js';
export { getSuiTestnetChainInput } from './suiTestnet.chain.js';
export { getArbitrumMainnetChainInput } from './arbitrumMainnet.chain.js';
export { getBaseMainnetChainInput } from './baseMainnet.chain.js';
export { getBaseSepoliaTestnetChainInput } from './base-sepolia-testnet.chain.js';
export { getSolanaDevnetImportedChainInput } from './solanaDevnetImported.chain.js';
