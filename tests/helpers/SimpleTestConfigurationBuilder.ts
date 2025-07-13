/**
 * Simple Test Configuration Builder
 * Replaces complex factory pattern with direct configuration building for tests
 * Follows 12-factor app principles with environment-based configuration
 */

import { CHAIN_TYPE, NETWORK } from '../../config/schemas/common.schema.js';
import type { AnyChainConfig } from '../../config/index.js';
import type { EvmChainConfig } from '../../config/schemas/evm.chain.schema.js';
import type { SolanaChainConfig } from '../../config/schemas/solana.chain.schema.js';
import type { StarknetChainConfig } from '../../config/schemas/starknet.chain.schema.js';
import type { SuiChainConfig } from '../../config/schemas/sui.chain.schema.js';

/**
 * Simple builder for creating test configurations
 * No complex factory patterns - just direct configuration objects
 */
export class SimpleTestConfigurationBuilder {
  /**
   * Create a basic EVM chain configuration for testing
   */
  static createEvmConfig(overrides?: Partial<EvmChainConfig>): EvmChainConfig {
    return {
      chainName: 'test-evm-chain',
      chainType: CHAIN_TYPE.EVM,
      network: NETWORK.TESTNET,

      // Required common fields
      privateKey:
        process.env.TEST_PRIVATE_KEY ||
        '0x0000000000000000000000000000000000000000000000000000000000000001',
      useEndpoint: false,
      supportsRevealDepositAPI: false,
      enableL2Redemption: false,

      // L1 configuration
      l1Rpc: process.env.TEST_L1_RPC || 'http://localhost:8545',
      l1ContractAddress:
        process.env.TEST_L1_CONTRACT || '0x1234567890123456789012345678901234567890',
      l1StartBlock: 0,
      l1Confirmations: 1,
      vaultAddress: process.env.TEST_VAULT || '0x0987654321098765432109876543210987654321',

      // L2 configuration
      l2Rpc: process.env.TEST_L2_RPC || 'http://localhost:8546',
      l2WsRpc: process.env.TEST_L2_WS_RPC || 'ws://localhost:8547',
      l2ContractAddress:
        process.env.TEST_L2_CONTRACT || '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      l2StartBlock: 0,

      // Wormhole configuration
      l2WormholeGatewayAddress:
        process.env.TEST_WORMHOLE_GATEWAY || '0x1111111111111111111111111111111111111111',
      l2WormholeChainId: 10002,
      useWormhole: false,

      ...overrides,
    };
  }

  /**
   * Create a basic Solana chain configuration for testing
   */
  static createSolanaConfig(overrides?: Partial<SolanaChainConfig>): SolanaChainConfig {
    return {
      chainName: 'test-solana-chain',
      chainType: CHAIN_TYPE.SOLANA,
      network: NETWORK.TESTNET,

      // Required common fields
      useEndpoint: false,
      supportsRevealDepositAPI: false,
      enableL2Redemption: false,

      // L1 configuration
      l1Rpc: process.env.TEST_L1_RPC || 'http://localhost:8545',
      l1ContractAddress:
        process.env.TEST_L1_CONTRACT || '0x1234567890123456789012345678901234567890',
      l1StartBlock: 0,
      l1Confirmations: 1,
      vaultAddress: process.env.TEST_VAULT || '0x0987654321098765432109876543210987654321',

      // L2 configuration
      l2Rpc: process.env.TEST_SOLANA_RPC || 'http://localhost:8899',
      l2WsRpc: process.env.TEST_SOLANA_WS_RPC || 'ws://localhost:8900',
      l2ContractAddress:
        process.env.TEST_SOLANA_CONTRACT || 'So11111111111111111111111111111111111111112',
      l2StartBlock: 0,

      // Wormhole configuration
      l2WormholeGatewayAddress:
        process.env.TEST_WORMHOLE_GATEWAY || 'GateWay1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o',
      l2WormholeChainId: 1,
      useWormhole: false,

      // Solana specific
      solanaPrivateKey:
        process.env.TEST_SOLANA_PRIVATE_KEY ||
        'So11111111111111111111111111111111111111111' + '1'.repeat(44),
      solanaCommitment: 'confirmed',
      solanaSignerKeyBase: process.env.TEST_SOLANA_SIGNER_KEY_BASE || 'test-signer-key-base',

      ...overrides,
    };
  }

  /**
   * Create a basic Starknet chain configuration for testing
   */
  static createStarknetConfig(overrides?: Partial<StarknetChainConfig>): StarknetChainConfig {
    return {
      chainName: 'test-starknet-chain',
      chainType: CHAIN_TYPE.STARKNET,
      network: NETWORK.TESTNET,

      // Required common fields
      useEndpoint: false,
      supportsRevealDepositAPI: false,
      enableL2Redemption: false,

      // L1 configuration
      l1Rpc: process.env.TEST_L1_RPC || 'http://localhost:8545',
      l1ContractAddress:
        process.env.TEST_L1_CONTRACT || '0x1234567890123456789012345678901234567890',
      l1StartBlock: 8489908,
      l1Confirmations: 1,
      vaultAddress: process.env.TEST_VAULT || '0x0987654321098765432109876543210987654321',

      // L2 configuration (optional for Starknet)
      l2Rpc: process.env.TEST_STARKNET_RPC || 'http://localhost:5050',

      // Starknet specific
      privateKey:
        process.env.TEST_PRIVATE_KEY ||
        '0x0000000000000000000000000000000000000000000000000000000000000001',
      starkGateBridgeAddress:
        process.env.TEST_STARKGATE_BRIDGE || '0x1234567890123456789012345678901234567890',
      l1FeeAmountWei: '0',
      useWormhole: false,

      ...overrides,
    };
  }

  /**
   * Create a basic Sui chain configuration for testing
   */
  static createSuiConfig(overrides?: Partial<SuiChainConfig>): SuiChainConfig {
    return {
      chainName: 'test-sui-chain',
      chainType: CHAIN_TYPE.SUI,
      network: NETWORK.TESTNET,

      // Required common fields
      useEndpoint: false,
      supportsRevealDepositAPI: false,
      enableL2Redemption: false,

      // L1 configuration
      l1Rpc: process.env.TEST_L1_RPC || 'http://localhost:8545',
      l1ContractAddress:
        process.env.TEST_L1_CONTRACT || '0x1234567890123456789012345678901234567890',
      l1StartBlock: 0,
      l1Confirmations: 1,
      vaultAddress: process.env.TEST_VAULT || '0x0987654321098765432109876543210987654321',

      // L2 configuration
      l2Rpc: process.env.TEST_SUI_RPC || 'http://localhost:9000',
      l2WsRpc: process.env.TEST_SUI_WS_RPC || 'ws://localhost:9001',
      l2ContractAddress:
        process.env.TEST_L2_CONTRACT ||
        '0x1234567890123456789012345678901234567890123456789012345678901234::bitcoin_depositor',
      l2StartBlock: 0,

      // Sui specific
      suiPrivateKey: process.env.TEST_SUI_PRIVATE_KEY || 'suiprivkey1' + 'a'.repeat(32) + '=',
      privateKey:
        process.env.TEST_PRIVATE_KEY ||
        '0x0000000000000000000000000000000000000000000000000000000000000001',
      useWormhole: false,

      // Sui-specific Wormhole and state objects
      wormholeCoreId:
        process.env.TEST_WORMHOLE_CORE_ID ||
        '0x1111111111111111111111111111111111111111111111111111111111111111',
      tokenBridgeId:
        process.env.TEST_TOKEN_BRIDGE_ID ||
        '0x2222222222222222222222222222222222222222222222222222222222222222',
      wrappedTbtcType:
        process.env.TEST_WRAPPED_TBTC_TYPE ||
        '0x1234567890123456789012345678901234567890123456789012345678901234::coin::COIN',
      receiverStateId:
        process.env.TEST_RECEIVER_STATE_ID ||
        '0x3333333333333333333333333333333333333333333333333333333333333333',
      gatewayStateId:
        process.env.TEST_GATEWAY_STATE_ID ||
        '0x4444444444444444444444444444444444444444444444444444444444444444',
      capabilitiesId:
        process.env.TEST_CAPABILITIES_ID ||
        '0x5555555555555555555555555555555555555555555555555555555555555555',
      treasuryId:
        process.env.TEST_TREASURY_ID ||
        '0x6666666666666666666666666666666666666666666666666666666666666666',
      tokenStateId:
        process.env.TEST_TOKEN_STATE_ID ||
        '0x7777777777777777777777777777777777777777777777777777777777777777',
      l2PackageId:
        process.env.TEST_L2_PACKAGE ||
        '0x1234567890123456789012345678901234567890123456789012345678901234',

      ...overrides,
    };
  }

  /**
   * Create configuration by chain type
   */
  static createByType(chainType: CHAIN_TYPE, overrides?: Record<string, any>): AnyChainConfig {
    switch (chainType) {
      case CHAIN_TYPE.EVM:
        return this.createEvmConfig(overrides);
      case CHAIN_TYPE.SOLANA:
        return this.createSolanaConfig(overrides);
      case CHAIN_TYPE.STARKNET:
        return this.createStarknetConfig(overrides);
      case CHAIN_TYPE.SUI:
        return this.createSuiConfig(overrides);
      default:
        throw new Error(`Unsupported chain type: ${chainType}`);
    }
  }

  /**
   * Create a minimal configuration for testing specific functionality
   */
  static createMinimal(chainName: string, chainType: CHAIN_TYPE): AnyChainConfig {
    const base = {
      chainName,
      chainType,
      network: NETWORK.TESTNET,
      useEndpoint: true,
      supportsRevealDepositAPI: false,
      enableL2Redemption: false,
      l1Rpc: 'http://test-l1.example.com',
      l1ContractAddress: '0x1234567890123456789012345678901234567890',
      l1StartBlock: 0,
      l1Confirmations: 1,
      vaultAddress: '0x0987654321098765432109876543210987654321',
      l2Rpc: 'http://test-l2.example.com',
      l2WsRpc: 'ws://test-l2.example.com',
      l2ContractAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      l2StartBlock: 0,
      useWormhole: false,
    };

    switch (chainType) {
      case CHAIN_TYPE.SOLANA:
        return {
          ...base,
          l2ContractAddress: 'So11111111111111111111111111111111111111112',
          l2WormholeGatewayAddress: 'GateWay1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o',
          l2WormholeChainId: 1,
          solanaPrivateKey: 'So11111111111111111111111111111111111111111' + '1'.repeat(44),
          solanaCommitment: 'confirmed',
          solanaSignerKeyBase: 'test-signer-key-base',
        } as SolanaChainConfig;
      case CHAIN_TYPE.STARKNET:
        return {
          ...base,
          l1StartBlock: 8489908,
          privateKey: '0x0000000000000000000000000000000000000000000000000000000000000001',
          starkGateBridgeAddress: '0x1234567890123456789012345678901234567890',
          l1FeeAmountWei: '0',
        } as StarknetChainConfig;
      case CHAIN_TYPE.SUI:
        return {
          ...base,
          l2ContractAddress:
            '0x1234567890123456789012345678901234567890123456789012345678901234::bitcoin_depositor',
          suiPrivateKey: 'suiprivkey1' + 'a'.repeat(32) + '=',
          privateKey: '0x0000000000000000000000000000000000000000000000000000000000000001',
          l2PackageId: '0x1234567890123456789012345678901234567890123456789012345678901234',
          wormholeCoreId: '0x1111111111111111111111111111111111111111111111111111111111111111',
          tokenBridgeId: '0x2222222222222222222222222222222222222222222222222222222222222222',
          wrappedTbtcType:
            '0x1234567890123456789012345678901234567890123456789012345678901234::coin::COIN',
          receiverStateId: '0x3333333333333333333333333333333333333333333333333333333333333333',
          gatewayStateId: '0x4444444444444444444444444444444444444444444444444444444444444444',
          capabilitiesId: '0x5555555555555555555555555555555555555555555555555555555555555555',
          treasuryId: '0x6666666666666666666666666666666666666666666666666666666666666666',
          tokenStateId: '0x7777777777777777777777777777777777777777777777777777777777777777',
        } as SuiChainConfig;
      default:
        return {
          ...base,
          privateKey: '0x0000000000000000000000000000000000000000000000000000000000000001',
          l2WormholeGatewayAddress: '0x1111111111111111111111111111111111111111',
          l2WormholeChainId: 10002,
        } as EvmChainConfig;
    }
  }
}
