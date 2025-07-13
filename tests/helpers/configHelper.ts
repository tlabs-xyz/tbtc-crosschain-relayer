/**
 * Simplified Configuration Test Helpers
 * Direct configuration building without factory pattern complexity
 */

import { CHAIN_TYPE, NETWORK } from '../../config/schemas/common.schema.js';
import { SimpleTestConfigurationBuilder } from './SimpleTestConfigurationBuilder.js';

/**
 * Simplified test environment configuration
 */
export interface TestEnvironmentConfig {
  /** Environment variables to set */
  env?: Record<string, string>;
}

/**
 * Simplified test environment setup result
 */
export interface TestEnvironment {
  configBuilder: SimpleTestConfigurationBuilder;
  cleanup: () => void;
}

/**
 * Setup a test environment with simplified configuration system
 */
export function setupTestEnvironment(config: TestEnvironmentConfig = {}): TestEnvironment {
  const originalEnv = { ...process.env };

  // Set environment variables if provided
  if (config.env) {
    Object.assign(process.env, config.env);
  }

  // Create configuration builder
  const configBuilder = new SimpleTestConfigurationBuilder();

  // Cleanup function to restore environment
  const cleanup = () => {
    process.env = originalEnv;
  };

  return {
    configBuilder,
    cleanup,
  };
}

/**
 * Helper to create mock environment variables for testing
 */
export function createMockEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    // Default test environment
    NODE_ENV: 'test',
    APP_NAME: 'Test App',
    APP_VERSION: '1.0.0',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',

    // Default chain configs
    ETHEREUM_RPC: 'http://localhost:8545',
    ETHEREUM_WS_RPC: 'ws://localhost:8545',

    // Override with provided values
    ...overrides,
  };
}

/**
 * Get test private key for a chain type
 */
export function getTestPrivateKey(chainType: CHAIN_TYPE): string {
  switch (chainType) {
    case CHAIN_TYPE.EVM:
      return '0x' + '1'.repeat(64);
    case CHAIN_TYPE.SOLANA:
      return 'A'.repeat(44); // Base58
    case CHAIN_TYPE.STARKNET:
      return '0x1234abcd';
    case CHAIN_TYPE.SUI:
      return 'dGVzdC1rZXktdmFsdWU='.padEnd(44, '='); // Base64
    default:
      throw new Error(`Unsupported chain type: ${chainType}`);
  }
}

/**
 * Create environment variables for a specific chain
 */
export function createChainEnv(
  chainName: string,
  chainType: CHAIN_TYPE,
  overrides: Record<string, string> = {},
): Record<string, string> {
  const upperChainName = chainName.toUpperCase();

  return {
    [`CHAIN_${upperChainName}_PRIVATE_KEY`]: getTestPrivateKey(chainType),
    ...overrides,
  };
}

/**
 * Create a test configuration for any chain type
 */
export function createTestConfig(chainType: CHAIN_TYPE, overrides: Record<string, any> = {}): any {
  switch (chainType) {
    case CHAIN_TYPE.EVM:
      return SimpleTestConfigurationBuilder.createEvmConfig(overrides);
    case CHAIN_TYPE.SOLANA:
      return SimpleTestConfigurationBuilder.createSolanaConfig(overrides);
    case CHAIN_TYPE.STARKNET:
      return SimpleTestConfigurationBuilder.createStarknetConfig(overrides);
    case CHAIN_TYPE.SUI:
      return SimpleTestConfigurationBuilder.createSuiConfig(overrides);
    default:
      throw new Error(`Unsupported chain type: ${chainType}`);
  }
}

/**
 * Create a minimal test configuration
 */
export function createMinimalTestConfig(chainName: string, chainType: CHAIN_TYPE): any {
  return createTestConfig(chainType, {
    chainName,
    useEndpoint: true,
    supportsRevealDepositAPI: false,
  });
}

/**
 * Pre-configured test configurations for common use
 */
export const TEST_CHAIN_CONFIGS = {
  evm: createTestConfig(CHAIN_TYPE.EVM, { chainName: 'test-evm' }),
  solana: createTestConfig(CHAIN_TYPE.SOLANA, { chainName: 'test-solana' }),
  starknet: createTestConfig(CHAIN_TYPE.STARKNET, { chainName: 'test-starknet' }),
  sui: createTestConfig(CHAIN_TYPE.SUI, { chainName: 'test-sui' }),
};
