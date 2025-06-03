import { z } from 'zod';
import { NETWORK, CHAIN_TYPE } from '../schemas/common.schema.js';
import type { EvmChainConfigSchema } from '../schemas/evm.chain.schema.js';
import { getEnv, getEnvNumber } from '../../utils/Env.js';
import {
  TBTC_VAULT_MAINNET,
  L1_CONFIRMATIONS,
  FEATURE_FLAGS,
  WORMHOLE_CHAIN_IDS,
  WORMHOLE_GATEWAYS,
  PUBLIC_RPCS,
  PUBLIC_WS_RPCS,
} from './common.chain.js';

type EvmChainInput = z.input<typeof EvmChainConfigSchema>;

export const arbitrumMainnetChainInput: EvmChainInput = {
  chainName: 'ArbitrumMainnet',
  chainType: CHAIN_TYPE.EVM,
  network: NETWORK.MAINNET,

  // Environment variables - SENSITIVE VALUES ONLY
  privateKey: getEnv('CHAIN_ARBITRUMMAINNET_PRIVATE_KEY'),

  // RPC Configuration - tBTC Protocol Architecture:
  // L1 = Ethereum Mainnet (core tBTC protocol deployment)
  // L2 = Arbitrum Mainnet (minter functionality deployment)

  // L1 RPC: Ethereum Mainnet (core tBTC protocol layer)
  l1Rpc: getEnv('ETHEREUM_MAINNET_RPC'),

  // L2 RPC: Arbitrum Mainnet (minter deployment layer)
  l2Rpc: getEnv('CHAIN_ARBITRUMMAINNET_L2_RPC', PUBLIC_RPCS['arbitrum-one']),

  // L2 WebSocket: Arbitrum Mainnet (for real-time minter events)
  l2WsRpc: getEnv('CHAIN_ARBITRUMMAINNET_L2_WS_RPC', PUBLIC_WS_RPCS['arbitrum-one']),

  // Block Configuration - Static defaults with optional environment override
  l2StartBlock: getEnvNumber('CHAIN_ARBITRUMMAINNET_L2_START_BLOCK', 247865814), // Arbitrum block for minter events
  l1Confirmations: getEnvNumber('CHAIN_ARBITRUMMAINNET_L1_CONFIRMATIONS', L1_CONFIRMATIONS.MAINNET), // Ethereum confirmations for security

  // Contract Addresses - VERIFIED from imported-configs/tbtc-arb-relayer.env
  l1ContractAddress: '0x75A6e4A7C8fAa162192FAD6C1F7A6d48992c619A', // L1BitcoinDepositor on Ethereum ✅ VERIFIED
  l2ContractAddress: '0x1C8d7b744b474c080faADd5BF9AD965Be4258F9e', // L2BitcoinDepositor on Arbitrum ✅ VERIFIED
  vaultAddress: TBTC_VAULT_MAINNET, // TBTCVault on Ethereum ✅ VERIFIED

  // Wormhole Configuration - RESEARCHED from Wormhole docs (see plan.md)
  l2WormholeGatewayAddress: WORMHOLE_GATEWAYS.ARBITRUM_ONE, // Wormhole Gateway on Arbitrum ✅ RESEARCHED
  l2WormholeChainId: WORMHOLE_CHAIN_IDS.ARBITRUM_ONE, // ✅ RESEARCHED - Arbitrum One Wormhole Chain ID

  // Feature Flags - Production mainnet defaults
  useEndpoint: FEATURE_FLAGS.USE_ENDPOINT, // Use direct blockchain listeners for better reliability
  enableL2Redemption: FEATURE_FLAGS.ENABLE_L2_REDEMPTION_MAINNET, // Enable minter redemption functionality on Arbitrum
};
