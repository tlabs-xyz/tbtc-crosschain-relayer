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
} as const;

type ChainSchemaRegistryEntry = {
  schema: z.ZodType<AnyChainConfig>;
  input: Record<string, unknown>;
};

export const chainConfigs: AllChainConfigs = {};
let hasChainConfigErrors = false;

logger.info('Loading chain configurations...');

logger.info(
  `[config/index.ts] Initial process.env.SUPPORTED_CHAINS: ${process.env.SUPPORTED_CHAINS}`,
);

// Determine which chains to load based on SUPPORTED_CHAINS env var
const supportedChainsEnv = process.env.SUPPORTED_CHAINS;
let chainsToLoad: string[] | null = null;

if (supportedChainsEnv && supportedChainsEnv.trim() !== '') {
  chainsToLoad = supportedChainsEnv
    .split(',')
    .map((chain) => chain.trim())
    .filter((chain) => chain.length > 0);
  logger.info(
    `SUPPORTED_CHAINS set. Will attempt to load configurations for: ${chainsToLoad.join(', ')}`,
  );
} else {
  logger.info(
    'SUPPORTED_CHAINS is not set. Will attempt to load all defined chain configurations.',
  );
}

const effectiveChainSchemaRegistry: Partial<
  Record<keyof typeof chainSchemaRegistry, ChainSchemaRegistryEntry>
> = {};
for (const key in chainSchemaRegistry) {
  if (Object.prototype.hasOwnProperty.call(chainSchemaRegistry, key)) {
    if (chainsToLoad) {
      if (chainsToLoad.includes(key)) {
        const entry = chainSchemaRegistry[key as keyof typeof chainSchemaRegistry];
        effectiveChainSchemaRegistry[key as keyof typeof chainSchemaRegistry] = {
          schema: entry.schema as z.ZodType<AnyChainConfig>,
          input: entry.input,
        };
      }
    } else {
      // Load all if chainsToLoad is null
      const entry = chainSchemaRegistry[key as keyof typeof chainSchemaRegistry];
      effectiveChainSchemaRegistry[key as keyof typeof chainSchemaRegistry] = {
        schema: entry.schema as z.ZodType<AnyChainConfig>,
        input: entry.input,
      };
    }
  }
}

for (const [key, entry] of Object.entries(effectiveChainSchemaRegistry)) {
  if (!entry) continue;

  try {
    logger.info(`Attempting to load configuration for chain: ${key}`);
    chainConfigs[key] = entry.schema.parse(entry.input) as AnyChainConfig;
    logger.info(`Successfully loaded configuration for chain: ${key}`);
  } catch (error: unknown) {
    hasChainConfigErrors = true;
    if (error instanceof z.ZodError) {
      const flattenedErrors = error.flatten();
      logger.error(`Config validation failed for '${key}'. Flattened errors:`, flattenedErrors);
      // Also log the detailed issues
      if (flattenedErrors.fieldErrors && Object.keys(flattenedErrors.fieldErrors).length > 0) {
        logger.error(`Field errors for '${key}':`, flattenedErrors.fieldErrors);
      }
      if (flattenedErrors.formErrors && flattenedErrors.formErrors.length > 0) {
        logger.error(`Form errors for '${key}':`, flattenedErrors.formErrors);
      }
    } else {
      logger.error(
        `An unexpected error occurred while loading chain configuration for '${key}':`,
        error,
      );
      // Log the error details
      if (error instanceof Error) {
        logger.error(`Error message: ${error.message}`);
        logger.error(`Error stack: ${error.stack}`);
      }
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
