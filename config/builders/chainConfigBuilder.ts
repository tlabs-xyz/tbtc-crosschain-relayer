import { z } from 'zod';
import type { EvmChainConfig } from '../schemas/evm.chain.schema.js';
import type { SolanaChainConfig } from '../schemas/solana.chain.schema.js';
import type { StarknetChainConfig } from '../schemas/starknet.chain.schema.js';
import type { SuiChainConfig } from '../schemas/sui.chain.schema.js';
import { chainSchemaRegistry } from '../chainRegistry.js';

/**
 * Unified chain configuration type
 */
export type ChainConfig = EvmChainConfig | SolanaChainConfig | StarknetChainConfig | SuiChainConfig;

/**
 * Configuration build result
 */
export interface ConfigBuildResult<T = ChainConfig> {
  success: boolean;
  data?: T;
  error?: string;
  validationErrors?: z.ZodError;
}

/**
 * Simplified configuration builder class
 */
export class ChainConfigBuilder {
  constructor() {
    // No initialization needed - configuration comes directly from environment
  }

  /**
   * Build configuration for any supported chain
   */
  async buildChainConfig(chainKey: string): Promise<ConfigBuildResult> {
    try {
      const registryEntry = chainSchemaRegistry[chainKey];
      if (!registryEntry) {
        return {
          success: false,
          error: `Chain '${chainKey}' is not registered`,
        };
      }

      // Get raw input data
      const inputData = registryEntry.getInputFunc();

      // Validate with schema
      const parseResult = registryEntry.schema.safeParse(inputData);
      if (!parseResult.success) {
        return {
          success: false,
          error: `Configuration validation failed for chain '${chainKey}'`,
          validationErrors: parseResult.error,
        };
      }

      return {
        success: true,
        data: parseResult.data,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to build configuration for chain '${chainKey}': ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Build all chain configurations
   */
  async buildAllConfigs(): Promise<Record<string, ConfigBuildResult>> {
    const results: Record<string, ConfigBuildResult> = {};
    const chainKeys = Object.keys(chainSchemaRegistry);

    for (const chainKey of chainKeys) {
      results[chainKey] = await this.buildChainConfig(chainKey);
    }

    return results;
  }

  /**
   * Validate a specific chain configuration
   */
  validateChainConfig(chainKey: string, config: unknown): ConfigBuildResult {
    try {
      const registryEntry = chainSchemaRegistry[chainKey];
      if (!registryEntry) {
        return {
          success: false,
          error: `Chain '${chainKey}' is not registered`,
        };
      }

      const parseResult = registryEntry.schema.safeParse(config);
      if (!parseResult.success) {
        return {
          success: false,
          error: `Configuration validation failed for chain '${chainKey}'`,
          validationErrors: parseResult.error,
        };
      }

      return {
        success: true,
        data: parseResult.data,
      };
    } catch (error) {
      return {
        success: false,
        error: `Validation error for chain '${chainKey}': ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get supported chain types
   */
  getSupportedChains(): string[] {
    return Object.keys(chainSchemaRegistry);
  }

  /**
   * Check if a chain is supported
   */
  isChainSupported(chainKey: string): boolean {
    return chainKey in chainSchemaRegistry;
  }

  /**
   * Get chain schema for a specific chain
   */
  getChainSchema(chainKey: string): z.ZodTypeAny | null {
    const registryEntry = chainSchemaRegistry[chainKey];
    return registryEntry?.schema || null;
  }
}

/**
 * Global builder instance
 */
export const chainConfigBuilder = new ChainConfigBuilder();
