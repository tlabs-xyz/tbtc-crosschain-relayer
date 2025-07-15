/**
 * Simplified Configuration Integration Tests
 * Tests the simplified configuration system without factory patterns
 */

import {
  setupTestEnvironment,
  createTestConfig,
  createMinimalTestConfig,
  TEST_CHAIN_CONFIGS,
} from '../../helpers/configHelper.js';
import { CHAIN_TYPE, NETWORK } from '../../../config/schemas/common.schema.js';
import type { TestEnvironment } from '../../helpers/configHelper.js';
import { SimpleTestConfigurationBuilder } from '../../helpers/SimpleTestConfigurationBuilder.js';

describe('Simplified Configuration Integration', () => {
  let testEnv: TestEnvironment;

  afterEach(() => {
    // Clean up after each test
    if (testEnv?.cleanup) {
      testEnv.cleanup();
    }
  });

  describe('Direct Configuration Creation', () => {
    it('should create a valid EVM configuration', () => {
      const config = SimpleTestConfigurationBuilder.createEvmConfig({
        chainName: 'Test Sepolia',
      });

      expect(config).toBeDefined();
      expect(config.chainType).toBe(CHAIN_TYPE.EVM);
      expect(config.chainName).toBe('Test Sepolia');
      expect(config.network).toBe(NETWORK.TESTNET);
    });

    it('should create configurations for all chain types', () => {
      const evmConfig = createTestConfig(CHAIN_TYPE.EVM, { chainName: 'test-evm' });
      const solanaConfig = createTestConfig(CHAIN_TYPE.SOLANA, { chainName: 'test-solana' });
      const starknetConfig = createTestConfig(CHAIN_TYPE.STARKNET, { chainName: 'test-starknet' });
      const suiConfig = createTestConfig(CHAIN_TYPE.SUI, { chainName: 'test-sui' });

      expect(evmConfig.chainType).toBe(CHAIN_TYPE.EVM);
      expect(solanaConfig.chainType).toBe(CHAIN_TYPE.SOLANA);
      expect(starknetConfig.chainType).toBe(CHAIN_TYPE.STARKNET);
      expect(suiConfig.chainType).toBe(CHAIN_TYPE.SUI);
    });

    it('should create minimal configurations', () => {
      const minimalEvm = createMinimalTestConfig('minimal-evm', CHAIN_TYPE.EVM);

      expect(minimalEvm.chainName).toBe('minimal-evm');
      expect(minimalEvm.chainType).toBe(CHAIN_TYPE.EVM);
      expect(minimalEvm.useEndpoint).toBe(true);
      expect(minimalEvm.supportsRevealDepositAPI).toBe(false);
    });
  });

  describe('Test Environment Integration', () => {
    it('should setup test environment with configuration builder', () => {
      testEnv = setupTestEnvironment({
        env: {
          TEST_L1_RPC: 'http://custom-l1:8545',
          TEST_PRIVATE_KEY: '0xcustom_key',
        },
      });

      expect(testEnv.configBuilder).toBeDefined();
      expect(testEnv.cleanup).toBeDefined();

      // Test that environment variables are set
      expect(process.env.TEST_L1_RPC).toBe('http://custom-l1:8545');
      expect(process.env.TEST_PRIVATE_KEY).toBe('0xcustom_key');
    });

    it('should clean up environment correctly', () => {
      const originalEnv = process.env.TEST_CUSTOM_VAR;

      testEnv = setupTestEnvironment({
        env: { TEST_CUSTOM_VAR: 'test_value' },
      });

      expect(process.env.TEST_CUSTOM_VAR).toBe('test_value');

      testEnv.cleanup();

      expect(process.env.TEST_CUSTOM_VAR).toBe(originalEnv);
    });
  });

  describe('Chain Type Specific Configurations', () => {
    it('should create Solana configuration with correct keys', () => {
      const config = SimpleTestConfigurationBuilder.createSolanaConfig({
        chainName: 'test-solana',
        solanaPrivateKey: 'custom_solana_key',
      });

      expect(config.chainType).toBe(CHAIN_TYPE.SOLANA);
      expect(config.solanaPrivateKey).toBe('custom_solana_key');
      expect('l2Rpc' in config).toBe(true);
    });

    it('should create Starknet configuration with required fields', () => {
      const config = SimpleTestConfigurationBuilder.createStarknetConfig({
        chainName: 'test-starknet',
        starkGateBridgeAddress: '0xcustom_bridge',
      });

      expect(config.chainType).toBe(CHAIN_TYPE.STARKNET);
      expect(config.starkGateBridgeAddress).toBe('0xcustom_bridge');
      expect('l1FeeAmountWei' in config).toBe(true);
      expect(config.l1StartBlock).toBe(8489908);
    });

    it('should create Sui configuration with all required fields', () => {
      const config = SimpleTestConfigurationBuilder.createSuiConfig({
        chainName: 'test-sui',
        suiPrivateKey: 'custom_sui_key',
        l2PackageId: '0xcustom_package',
      });

      expect(config.chainType).toBe(CHAIN_TYPE.SUI);
      expect(config.suiPrivateKey).toBe('custom_sui_key');
      expect(config.l2PackageId).toBe('0xcustom_package');
      expect('receiverStateId' in config).toBe(true);
      expect('gatewayStateId' in config).toBe(true);
    });
  });

  describe('Pre-configured Test Configurations', () => {
    it('should provide ready-to-use test configurations', () => {
      expect(TEST_CHAIN_CONFIGS.evm).toBeDefined();
      expect(TEST_CHAIN_CONFIGS.solana).toBeDefined();
      expect(TEST_CHAIN_CONFIGS.starknet).toBeDefined();
      expect(TEST_CHAIN_CONFIGS.sui).toBeDefined();

      expect(TEST_CHAIN_CONFIGS.evm.chainName).toBe('test-evm');
      expect(TEST_CHAIN_CONFIGS.solana.chainName).toBe('test-solana');
    });
  });

  describe('Configuration Overrides', () => {
    it('should allow complete override of configuration values', () => {
      const config = SimpleTestConfigurationBuilder.createEvmConfig({
        chainName: 'custom-chain',
        network: NETWORK.MAINNET,
        enableL2Redemption: true,
        l1Rpc: 'https://custom-l1.example.com',
        privateKey: '0xcustom_private_key',
      });

      expect(config.chainName).toBe('custom-chain');
      expect(config.network).toBe(NETWORK.MAINNET);
      expect(config.enableL2Redemption).toBe(true);
      expect(config.l1Rpc).toBe('https://custom-l1.example.com');
      expect(config.privateKey).toBe('0xcustom_private_key');
    });

    it('should maintain type safety with overrides', () => {
      // This should work - valid override
      const validConfig = SimpleTestConfigurationBuilder.createEvmConfig({
        chainType: CHAIN_TYPE.EVM, // Should match
        enableL2Redemption: true,
      });

      expect(validConfig.chainType).toBe(CHAIN_TYPE.EVM);
      expect(validConfig.enableL2Redemption).toBe(true);
    });
  });
});
