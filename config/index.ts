import { z } from 'zod';
import { EvmChainConfigSchema, type EvmChainConfig } from './schemas/evm.chain.schema.js';
import { SolanaChainConfigSchema, type SolanaChainConfig } from './schemas/solana.chain.schema.js';
import {
  StarknetChainConfigSchema,
  type StarknetChainConfig,
} from './schemas/starknet.chain.schema.js';
import { SuiChainConfigSchema, type SuiChainConfig } from './schemas/sui.chain.schema.js';
import { sepoliaTestnetChainInput } from './chain/sepolia.chain.js';
import { solanaDevnetChainInput } from './chain/solana.chain.js';
import { starknetTestnetChainInput } from './chain/starknet.chain.js';
import { suiTestnetChainInput } from './chain/sui.chain.js';
import { arbitrumMainnetChainInput } from './chain/arbitrum-mainnet.chain.js';
import { baseMainnetChainInput } from './chain/base-mainnet.chain.js';
import { baseSepoliaTestnetChainInput } from './chain/base-sepolia-testnet.chain.js';
import { solanaDevnetImportedChainInput } from './chain/solana-devnet-imported.chain.js';
import logger from '../utils/Logger.js';
import { writeFileSync } from 'fs';

logger.info('Application configuration loaded successfully.');

export type AnyChainConfig =
  | EvmChainConfig
  | SolanaChainConfig
  | StarknetChainConfig
  | SuiChainConfig;

export interface AllChainConfigs {
  sepoliaTestnet?: EvmChainConfig;
  solanaDevnet?: SolanaChainConfig;
  starknetTestnet?: StarknetChainConfig;
  suiTestnet?: SuiChainConfig;
  // Legacy chain configurations
  arbitrumMainnet?: EvmChainConfig;
  baseMainnet?: EvmChainConfig;
  baseSepoliaTestnet?: EvmChainConfig;
  solanaDevnetImported?: SolanaChainConfig;
  [key: string]: AnyChainConfig | undefined;
}

// Registry for chain configurations
// The 'input' can be an empty object {} if all values are defaulted in the Zod schema or sourced from ENV via preprocessors.
const chainSchemaRegistry = {
  sepoliaTestnet: { schema: EvmChainConfigSchema, input: sepoliaTestnetChainInput },
  solanaDevnet: { schema: SolanaChainConfigSchema, input: solanaDevnetChainInput },
  starknetTestnet: { schema: StarknetChainConfigSchema, input: starknetTestnetChainInput },
  suiTestnet: { schema: SuiChainConfigSchema, input: suiTestnetChainInput },
  arbitrumMainnet: { schema: EvmChainConfigSchema, input: arbitrumMainnetChainInput },
  baseMainnet: { schema: EvmChainConfigSchema, input: baseMainnetChainInput },
  baseSepoliaTestnet: { schema: EvmChainConfigSchema, input: baseSepoliaTestnetChainInput },
  solanaDevnetImported: { schema: SolanaChainConfigSchema, input: solanaDevnetImportedChainInput },
};

export const chainConfigs: AllChainConfigs = {};
let hasChainConfigErrors = false;

logger.info('Loading chain configurations...');

for (const [key, entry] of Object.entries(chainSchemaRegistry)) {
  try {
    logger.info(`Attempting to load configuration for chain: ${key}`);
    // The 'input' field from the registry is passed to .parse()
    // If input is an empty object, Zod relies on defaults and preprocessors
    chainConfigs[key] = entry.schema.parse(entry.input);
    logger.info(`Successfully loaded configuration for chain: ${key}`);
  } catch (error: any) {
    hasChainConfigErrors = true;
    if (error instanceof z.ZodError) {
      const errorDetails = {
        chain: key,
        flattened: error.flatten(),
        errors: error.errors,
        input: entry.input,
      };
      writeFileSync('/tmp/config-error.json', JSON.stringify(errorDetails, null, 2));
      logger.error(
        `Config validation failed for '${key}'. Flattened errors:`,
        JSON.stringify(error.flatten(), null, 2),
      );
      logger.error(`Raw Zod error for '${key}':`, error.errors);
      logger.error(`Error details written to /tmp/config-error.json`);
    } else {
      logger.error(
        `An unexpected error occurred while loading chain configuration for '${key}':`,
        error,
      );
    }
  }
}

if (hasChainConfigErrors) {
  logger.error(
    'One or more chain configurations failed to load. Please check logs above. Exiting.',
  );
  // process.exit(1); // Temporarily disabled for debugging
}

logger.info(`Successfully loaded ${Object.keys(chainConfigs).length} chain configuration(s).`);
