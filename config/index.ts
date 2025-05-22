import { z } from 'zod';
import { AppConfigSchema, type AppConfig } from './schemas/app.schema.js';
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
import logger from '../utils/Logger.js';



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
  [key: string]: AnyChainConfig | undefined;
}

// Registry for chain configurations
// The 'input' can be an empty object {} if all values are defaulted in the Zod schema or sourced from ENV via preprocessors.
const chainSchemaRegistry = {
  sepoliaTestnet: { schema: EvmChainConfigSchema, input: sepoliaTestnetChainInput },
  solanaDevnet: { schema: SolanaChainConfigSchema, input: solanaDevnetChainInput },
  starknetTestnet: { schema: StarknetChainConfigSchema, input: starknetTestnetChainInput },
  suiTestnet: { schema: SuiChainConfigSchema, input: suiTestnetChainInput },
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
      logger.error(`Config validation failed for '${key}'. Flattened errors:`, error.flatten());
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
  process.exit(1);
}

logger.info(`Successfully loaded ${Object.keys(chainConfigs).length} chain configuration(s).`);
