import { z } from 'zod';
import { EvmChainConfigSchema, type EvmChainConfig } from './schemas/evm.chain.schema';
import { SolanaChainConfigSchema, type SolanaChainConfig } from './schemas/solana.chain.schema';
import {
  StarknetChainConfigSchema,
  type StarknetChainConfig,
} from './schemas/starknet.chain.schema';
import { SuiChainConfigSchema, type SuiChainConfig } from './schemas/sui.chain.schema';
import { getSepoliaTestnetChainInput } from './chain/sepolia.chain';
import { getSolanaDevnetChainInput } from './chain/solana.chain';
import { getStarknetTestnetChainInput } from './chain/starknet.chain';
import { getSuiTestnetChainInput } from './chain/sui.chain';
import { getArbitrumMainnetChainInput } from './chain/arbitrumMainnet.chain';
import { getBaseMainnetChainInput } from './chain/baseMainnet.chain';
import { getSolanaDevnetImportedChainInput } from './chain/solanaDevnetImported.chain';
import baseLogger from '../utils/Logger.js';
import { writeFileSync } from 'fs';

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
  arbitrumMainnet?: EvmChainConfig;
  baseMainnet?: EvmChainConfig;
  solanaDevnetImported?: SolanaChainConfig;
  [key: string]: AnyChainConfig | undefined;
}

interface ChainSchemaRegistryEntry {
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
}

// Registry for chain configurations
// Each entry provides the Zod schema and the corresponding getInput function.
const chainSchemaRegistry: Record<string, ChainSchemaRegistryEntry> = {
  sepoliaTestnet: { schema: EvmChainConfigSchema, getInputFunc: getSepoliaTestnetChainInput },
  solanaDevnet: { schema: SolanaChainConfigSchema, getInputFunc: getSolanaDevnetChainInput },
  starknetTestnet: {
    schema: StarknetChainConfigSchema,
    getInputFunc: getStarknetTestnetChainInput,
  },
  suiTestnet: { schema: SuiChainConfigSchema, getInputFunc: getSuiTestnetChainInput },
  arbitrumMainnet: { schema: EvmChainConfigSchema, getInputFunc: getArbitrumMainnetChainInput },
  baseMainnet: { schema: EvmChainConfigSchema, getInputFunc: getBaseMainnetChainInput },
  solanaDevnetImported: {
    schema: SolanaChainConfigSchema,
    getInputFunc: getSolanaDevnetImportedChainInput,
  },
};

export interface ChainValidationError {
  chainKey: string;
  error: any; // Can be ZodError.flatten(), Error object, or other
  input?: any; // The input that failed validation, or a string explaining why it's not available
  isZodError?: boolean; // Flag to distinguish Zod errors for logging
}

export function loadAndValidateChainConfigs(
  targetChainKeys: string[],
  logger: typeof baseLogger, // Expecting a logger instance
): { configs: AllChainConfigs; validationErrors: ChainValidationError[] } {
  const loadedConfigs: AllChainConfigs = {};
  const validationErrors: ChainValidationError[] = [];

  logger.info(`Attempting to load configurations for chains: ${targetChainKeys.join(', ')}`);

  for (const key of targetChainKeys) {
    const entry = chainSchemaRegistry[key];
    if (!entry) {
      logger.warn(`No schema registry entry found for requested chain: ${key}. Skipping.`);
      validationErrors.push({
        chainKey: key,
        error: 'No schema registry entry found',
        input: 'N/A due to missing registry entry',
        isZodError: false,
      });
      continue;
    }

    let inputForThisChain: any = null; // Variable to store input if getInputFunc succeeds
    try {
      logger.info(`Attempting to load and validate configuration for chain: ${key}`);
      inputForThisChain = entry.getInputFunc();
      loadedConfigs[key] = entry.schema.parse(inputForThisChain) as AnyChainConfig;
      logger.info(`Successfully loaded configuration for chain: ${key}`);
    } catch (error: any) {
      const isZodError = error instanceof z.ZodError;
      const errorPayloadToStore = isZodError ? error.flatten() : error; // Store raw error if not Zod

      let capturedInput: any;
      if (inputForThisChain === null) {
        // This means entry.getInputFunc() itself failed. The 'error' variable holds this failure.
        capturedInput = `Input data could not be retrieved for chain '${key}'. The failure occurred during input generation with error: ${error instanceof Error ? error.message : String(error)}`;
      } else {
        // entry.getInputFunc() succeeded, so inputForThisChain is the data that was attempted to be parsed.
        // This branch is typically for ZodErrors, where parsing inputForThisChain failed.
        capturedInput = inputForThisChain;
      }

      const errorDetails: ChainValidationError = {
        chainKey: key,
        error: errorPayloadToStore,
        input: capturedInput,
        isZodError: isZodError,
      };
      validationErrors.push(errorDetails);

      if (isZodError) {
        const zodErrorData = {
          chain: key,
          flattened: error.flatten(),
          errors: error.errors,
          inputAttempted: errorDetails.input,
        };
        logger.error(
          `Config validation failed for '${key}'. Flattened Zod errors: ${JSON.stringify(zodErrorData.flattened, null, 2)}`,
        );
      } else {
        // Enhanced logging for non-Zod errors
        logger.error(`--------------------------------------------------------------------`);
        logger.error(`--- UNEXPECTED ERROR loading/validating chain '${key}' ---`);
        logger.error(`--------------------------------------------------------------------`);
        logger.error(`Chain Key: ${key}`);
        logger.error(`Error Message: ${error.message || 'No message property'}`);
        logger.error(`Error Type: ${error.constructor ? error.constructor.name : typeof error}`);
        // Avoid serializing potentially huge or circular objects directly with logger if it struggles
        try {
          logger.error(
            `Full Error Object (stringified): ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
          );
        } catch {
          logger.error('Full Error Object (could not stringify, logging raw):', error);
        }
        if (error.stack) {
          logger.error('Stack Trace:', error.stack);
        }
        logger.error(
          `Input that may have caused error:`,
          JSON.stringify(errorDetails.input, null, 2),
        );
        logger.error(`--------------------------------------------------------------------`);
      }
    }
  }

  if (validationErrors.length > 0) {
    logger.warn(`Found ${validationErrors.length} error(s) during chain configuration loading.`);
  }
  logger.info(
    `Successfully loaded ${Object.keys(loadedConfigs).length} chain configuration(s) out of ${targetChainKeys.length} requested.`,
  );
  return { configs: loadedConfigs, validationErrors };
}

// --- Application's main chainConfigs export ---
// This section ensures the application still gets its chainConfigs
// and exits on error during normal startup.

let mainChainConfigs: AllChainConfigs = {};
let mainChainConfigErrors: ChainValidationError[] = [];

try {
  const supportedChainsEnv = process.env.SUPPORTED_CHAINS;
  let chainsToLoad: string[];

  if (supportedChainsEnv && supportedChainsEnv.trim() !== '') {
    chainsToLoad = supportedChainsEnv
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s);
    if (chainsToLoad.length === 0 && supportedChainsEnv.trim() !== '') {
      baseLogger.warn(
        'SUPPORTED_CHAINS environment variable was set but resulted in an empty list of chains after parsing. This might be unintentional.',
      );
    } else if (chainsToLoad.length === 0) {
      baseLogger.info(
        'SUPPORTED_CHAINS is empty or not set. No specific chains will be loaded by default.',
      );
    }
  } else {
    // If SUPPORTED_CHAINS is not set or empty, default to loading all registered chains.
    // This maintains previous behavior where all chains defined were attempted.
    // For CI or validation scripts, this behavior might be overridden by explicitly passing an empty array.
    baseLogger.info(
      'SUPPORTED_CHAINS is not set. Attempting to load all registered chain configurations.',
    );
    chainsToLoad = Object.keys(chainSchemaRegistry);
  }

  if (chainsToLoad.length > 0) {
    const result = loadAndValidateChainConfigs(chainsToLoad, baseLogger);
    mainChainConfigs = result.configs;
    mainChainConfigErrors = result.validationErrors;
  } else {
    baseLogger.info(
      'No chains specified to load via SUPPORTED_CHAINS, and not defaulting to all chains. chainConfigs will be empty.',
    );
  }

  if (mainChainConfigErrors.length > 0) {
    baseLogger.error('--------------------------------------------------------------------');
    baseLogger.error('--- CHAIN CONFIGURATION ERRORS DETECTED DURING STARTUP ---');
    baseLogger.error('--------------------------------------------------------------------');
    mainChainConfigErrors.forEach((err) => {
      baseLogger.error(`Chain '${err.chainKey}': Validation FAILED.`);
      try {
        baseLogger.error(`Input that led to error: ${JSON.stringify(err.input, null, 2)}`);
        if (err.isZodError) {
          baseLogger.error(`Zod Error details: ${JSON.stringify(err.error, null, 2)}`);
        } else {
          // For raw Error objects or other non-Zod errors, use Object.getOwnPropertyNames for better serialization
          baseLogger.error(`Error details: ${JSON.stringify(err.error, Object.getOwnPropertyNames(err.error), 2)}`);
        }
      } catch {
        baseLogger.error('Failed to stringify error details. Logging raw objects:');
        baseLogger.error('Raw Input:', err.input);
        baseLogger.error('Raw Error:', err.error); // err.error is the raw error object here or flattened Zod error
      }
      baseLogger.error('---');
    });
    writeFileSync(
      '/tmp/all-chain-config-errors.json',
      JSON.stringify(mainChainConfigErrors, null, 2),
    );
    baseLogger.error('Detailed errors written to /tmp/all-chain-config-errors.json');
    baseLogger.error('Application will now exit.');
    baseLogger.error('--------------------------------------------------------------------');
    process.exit(1); // Critical failure for application startup
  }

  if (Object.keys(mainChainConfigs).length === 0 && chainsToLoad.length > 0) {
    baseLogger.warn(
      'Chain configuration loading attempted for specified chains, but resulted in an empty chainConfigs object. This might indicate issues with all specified chain configurations.',
    );
    // Decide if this is a critical failure. If chains were specified but none loaded, it's usually an error.
    if (process.env.NODE_ENV !== 'test' && process.env.API_ONLY_MODE !== 'true') {
      // Behave like original check in validate-config
      baseLogger.error(
        'No chain configurations successfully loaded, and not in test or API_ONLY_MODE. Server would likely fail. Exiting.',
      );
      process.exit(1);
    }
  }

  baseLogger.info(
    `Application startup: Successfully loaded ${Object.keys(mainChainConfigs).length} chain configuration(s).`,
  );
} catch (e: any) {
  baseLogger.error('--------------------------------------------------------------------');
  baseLogger.error('--- FATAL ERROR DURING CHAIN CONFIGURATION INITIALIZATION ---');
  baseLogger.error('--------------------------------------------------------------------');
  baseLogger.error(`Error Message: ${e.message || 'No message property'}`);
  baseLogger.error(`Error Type: ${e.constructor ? e.constructor.name : typeof e}`);
  try {
    baseLogger.error(`Full Error Object (stringified): ${JSON.stringify(e, Object.getOwnPropertyNames(e), 2)}`);
  } catch {
    baseLogger.error('Full Error Object (could not stringify, logging raw): ', e);
  }
  if (e.stack) {
    baseLogger.error('Stack Trace:', e.stack);
  }
  baseLogger.error('--------------------------------------------------------------------');
  process.exit(1);
}

export const chainConfigs: AllChainConfigs = mainChainConfigs;
// Expose the registry for scenarios where it might be useful to know all possible chains
export const getAvailableChainKeys = (): string[] => Object.keys(chainSchemaRegistry);

baseLogger.info('Chain configuration module initialized.');
