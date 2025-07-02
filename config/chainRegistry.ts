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
import { getArbitrumSepoliaChainInput } from './chain/arbitrumSepolia.chain.js';
import { getStarknetMainnetChainInput } from './chain/starknetMainnet.chain.js';

// Re-exporting these types as they might be useful for consumers of the registry
export type { EvmChainConfig, SolanaChainConfig, StarknetChainConfig, SuiChainConfig };

export interface ChainSchemaRegistryEntry<S extends z.ZodTypeAny> {
  schema: S;
  getInputFunc: () => z.input<S>;
  // chainType?: CHAIN_TYPE;
}

type ChainSchemaRegistry = {
  sepoliaTestnet: ChainSchemaRegistryEntry<typeof EvmChainConfigSchema>;
  solanaDevnet: ChainSchemaRegistryEntry<typeof SolanaChainConfigSchema>;
  starknetTestnet: ChainSchemaRegistryEntry<typeof StarknetChainConfigSchema>;
  starknetMainnet: ChainSchemaRegistryEntry<typeof StarknetChainConfigSchema>;
  suiTestnet: ChainSchemaRegistryEntry<typeof SuiChainConfigSchema>;
  arbitrumMainnet: ChainSchemaRegistryEntry<typeof EvmChainConfigSchema>;
  baseMainnet: ChainSchemaRegistryEntry<typeof EvmChainConfigSchema>;
  baseSepoliaTestnet: ChainSchemaRegistryEntry<typeof EvmChainConfigSchema>;
  solanaDevnetImported: ChainSchemaRegistryEntry<typeof SolanaChainConfigSchema>;
  [key: string]: ChainSchemaRegistryEntry<z.ZodTypeAny>;
};

export const chainSchemaRegistry: ChainSchemaRegistry = {
  sepoliaTestnet: { schema: EvmChainConfigSchema, getInputFunc: getSepoliaTestnetChainInput },
  solanaDevnet: { schema: SolanaChainConfigSchema, getInputFunc: getSolanaDevnetChainInput },
  starknetTestnet: {
    schema: StarknetChainConfigSchema,
    getInputFunc: getStarknetTestnetChainInput,
  },
  starknetMainnet: {
    schema: StarknetChainConfigSchema,
    getInputFunc: getStarknetMainnetChainInput,
  },
  suiTestnet: { schema: SuiChainConfigSchema, getInputFunc: getSuiTestnetChainInput },
  arbitrumMainnet: { schema: EvmChainConfigSchema, getInputFunc: getArbitrumMainnetChainInput },
  baseMainnet: { schema: EvmChainConfigSchema, getInputFunc: getBaseMainnetChainInput },
  baseSepoliaTestnet: {
    schema: EvmChainConfigSchema,
    getInputFunc: getBaseSepoliaTestnetChainInput,
  }, // Added baseSepoliaTestnet
  arbitrumSepolia: {
    schema: EvmChainConfigSchema,
    getInputFunc: getArbitrumSepoliaChainInput,
  },
  solanaDevnetImported: {
    schema: SolanaChainConfigSchema,
    getInputFunc: getSolanaDevnetImportedChainInput,
  },
  // Add other chains here if they become supported
};

export const getAvailableChainKeys = (): string[] => Object.keys(chainSchemaRegistry);
