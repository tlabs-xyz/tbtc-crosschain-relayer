import { z } from 'zod';
import { EvmChainConfigSchema, type EvmChainConfig } from './schemas/evm.chain.schema.js';
import { SolanaChainConfigSchema, type SolanaChainConfig } from './schemas/solana.chain.schema.js';
import {
  StarknetChainConfigSchema,
  type StarknetChainConfig,
} from './schemas/starknet.chain.schema.js';
import { SuiChainConfigSchema, type SuiChainConfig } from './schemas/sui.chain.schema.js';

import { getSepoliaTestnetChainInput } from './chain/sepolia.chain.js';
import { getSolanaDevnetChainInput } from './chain/solana.chain.js';
import { getStarknetTestnetChainInput } from './chain/starknet.chain.js';
import { getSuiTestnetChainInput } from './chain/sui.chain.js';
import { getArbitrumMainnetChainInput } from './chain/arbitrumMainnet.chain.js';
import { getBaseMainnetChainInput } from './chain/baseMainnet.chain.js';
import { getSolanaDevnetImportedChainInput } from './chain/solanaDevnetImported.chain.js';
import { getBaseSepoliaTestnetChainInput } from './chain/base-sepolia-testnet.chain.js'; // Assuming this path and export

// Re-exporting these types as they might be useful for consumers of the registry
export type { EvmChainConfig, SolanaChainConfig, StarknetChainConfig, SuiChainConfig };

export interface ChainSchemaRegistryEntry {
  schema:
    | typeof EvmChainConfigSchema
    | typeof SolanaChainConfigSchema
    | typeof StarknetChainConfigSchema
    | typeof SuiChainConfigSchema;
  getInputFunc: () => z.input<
    | typeof EvmChainConfigSchema
    | typeof SolanaChainConfigSchema
    | typeof StarknetChainConfigSchema
    | typeof SuiChainConfigSchema
  >;
  // Add chainType here for easier access if needed elsewhere, though not strictly necessary for current refactor
  // chainType: CHAIN_TYPE;
}

export const chainSchemaRegistry: Record<string, ChainSchemaRegistryEntry> = {
  sepoliaTestnet: { schema: EvmChainConfigSchema, getInputFunc: getSepoliaTestnetChainInput },
  solanaDevnet: { schema: SolanaChainConfigSchema, getInputFunc: getSolanaDevnetChainInput },
  starknetTestnet: {
    schema: StarknetChainConfigSchema,
    getInputFunc: getStarknetTestnetChainInput,
  },
  suiTestnet: { schema: SuiChainConfigSchema, getInputFunc: getSuiTestnetChainInput },
  arbitrumMainnet: { schema: EvmChainConfigSchema, getInputFunc: getArbitrumMainnetChainInput },
  baseMainnet: { schema: EvmChainConfigSchema, getInputFunc: getBaseMainnetChainInput },
  baseSepoliaTestnet: {
    schema: EvmChainConfigSchema,
    getInputFunc: getBaseSepoliaTestnetChainInput,
  }, // Added baseSepoliaTestnet
  solanaDevnetImported: {
    schema: SolanaChainConfigSchema,
    getInputFunc: getSolanaDevnetImportedChainInput,
  },
  // Add other chains here if they become supported
};

export const getAvailableChainKeys = (): string[] => Object.keys(chainSchemaRegistry);
