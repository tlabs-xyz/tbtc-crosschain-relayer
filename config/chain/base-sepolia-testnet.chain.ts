import { z } from 'zod';
import { NETWORK, CHAIN_TYPE } from '../schemas/common.schema.js';
import type { EvmChainConfigSchema } from '../schemas/evm.chain.schema.js';
import { getEnv, getEnvNumber } from '../../utils/Env.js';
import {
  TBTC_VAULT_TESTNET,
  L1_CONFIRMATIONS,
  FEATURE_FLAGS,
  WORMHOLE_CHAIN_IDS,
  WORMHOLE_GATEWAYS,
  PUBLIC_RPCS,
  PUBLIC_WS_RPCS,
} from './common.chain.js';

type EvmChainInput = z.input<typeof EvmChainConfigSchema>;

export const baseSepoliaTestnetChainInput: EvmChainInput = {
  chainName: 'BaseSepoliaTestnet',
  chainType: CHAIN_TYPE.EVM,
  network: NETWORK.TESTNET,

  // Environment variables - SENSITIVE VALUES ONLY
  privateKey: getEnv('CHAIN_BASESEPOLIATESTNET_PRIVATE_KEY'),

  // RPC Configuration - tBTC Protocol Architecture (Testnet):
  // L1 = Ethereum Sepolia (core tBTC protocol deployment - testnet)
  // L2 = Base Sepolia (minter functionality deployment - testnet)

  // L1 RPC: Ethereum Sepolia (core tBTC protocol layer - testnet)
  l1Rpc: getEnv('ETHEREUM_SEPOLIA_RPC'),

  // L2 RPC: Base Sepolia (minter deployment layer - testnet)
  l2Rpc: getEnv('CHAIN_BASESEPOLIATESTNET_L2_RPC', PUBLIC_RPCS['base-sepolia']),

  // L2 WebSocket: Base Sepolia (for real-time minter events - testnet)
  l2WsRpc: getEnv('CHAIN_BASESEPOLIATESTNET_L2_WS_RPC', PUBLIC_WS_RPCS['base-sepolia']),

  // Block Configuration - Static defaults with optional environment override
  l2StartBlock: getEnvNumber('CHAIN_BASESEPOLIATESTNET_L2_START_BLOCK', 123456), // Base Sepolia block for minter events
  l1Confirmations: getEnvNumber(
    'CHAIN_BASESEPOLIATESTNET_L1_CONFIRMATIONS',
    L1_CONFIRMATIONS.TESTNET,
  ), // Ethereum Sepolia confirmations (faster for testing)

  // Contract Addresses - VERIFIED from imported-configs/base-sepolia-tbtc-arb-relayer.env
  l1ContractAddress: '0x59FAE614867b66421b44D1Ed3461e6B6a4B50106', // L1BitcoinDepositor on Ethereum Sepolia ✅ VERIFIED
  l2ContractAddress: '0xDEbD9aA9BC4845c7Cd2d9a997F82A2Daea540bD5', // L2BitcoinDepositor on Base Sepolia ✅ VERIFIED
  vaultAddress: TBTC_VAULT_TESTNET, // TBTCVault on Ethereum Sepolia ✅ VERIFIED

  // Wormhole Configuration - RESEARCHED from Wormhole docs (see plan.md)
  l2WormholeGatewayAddress: WORMHOLE_GATEWAYS.BASE_SEPOLIA, // Wormhole Gateway on Base Sepolia ✅ RESEARCHED
  l2WormholeChainId: WORMHOLE_CHAIN_IDS.BASE_SEPOLIA, // ✅ RESEARCHED - Base Sepolia Wormhole Chain ID

  // Feature Flags - Testnet defaults (typically enabled for testing)
  useEndpoint: FEATURE_FLAGS.USE_ENDPOINT, // Use direct blockchain listeners for testing
  enableL2Redemption: FEATURE_FLAGS.ENABLE_L2_REDEMPTION_TESTNET, // Enable minter redemption functionality for testing on Base Sepolia
};
