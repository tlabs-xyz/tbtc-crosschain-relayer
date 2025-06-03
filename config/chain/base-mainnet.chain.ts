import { z } from 'zod';
import { NETWORK, CHAIN_TYPE } from '../schemas/common.schema.js';
import type { EvmChainConfigSchema } from '../schemas/evm.chain.schema.js';
import { getEnv, getEnvNumber } from '../../utils/Env.js';
import {
  buildL1RpcUrl,
  buildL2RpcUrl,
  buildL2WsUrl,
  TBTC_VAULT_MAINNET,
  L1_CONFIRMATIONS,
  FEATURE_FLAGS,
  WORMHOLE_CHAIN_IDS,
  WORMHOLE_GATEWAYS,
  PUBLIC_RPCS,
  PUBLIC_WS_RPCS,
} from './common.chain.js';

type EvmChainInput = z.input<typeof EvmChainConfigSchema>;

export const baseMainnetChainInput: EvmChainInput = {
  chainName: 'BaseMainnet',
  chainType: CHAIN_TYPE.EVM,
  network: NETWORK.MAINNET,

  // Environment variables - SENSITIVE VALUES ONLY
  privateKey: getEnv('CHAIN_BASEMAINNET_PRIVATE_KEY'),

  // RPC Configuration - tBTC Protocol Architecture (Backup Instance):
  // L1 = Ethereum Mainnet (core tBTC protocol deployment)
  // L2 = Base Mainnet (minter functionality deployment)

  // L1 RPC: Ethereum Mainnet (core tBTC protocol layer)
  l1Rpc: buildL1RpcUrl(),

  // L2 RPC: Base Mainnet (minter deployment layer - backup instance)
  l2Rpc: buildL2RpcUrl('CHAIN_BASEMAINNET_L2_RPC', 'base-mainnet', PUBLIC_RPCS['base-mainnet']),

  // L2 WebSocket: Base Mainnet (for real-time minter events - backup)
  l2WsRpc: buildL2WsUrl(
    'CHAIN_BASEMAINNET_L2_WS_RPC',
    'base-mainnet',
    PUBLIC_WS_RPCS['base-mainnet'],
  ),

  // Block Configuration - Static defaults with optional environment override
  l2StartBlock: getEnvNumber('CHAIN_BASEMAINNET_L2_START_BLOCK', 26922966), // Base block for minter events
  l1Confirmations: getEnvNumber('CHAIN_BASEMAINNET_L1_CONFIRMATIONS', L1_CONFIRMATIONS.MAINNET), // Ethereum confirmations for security

  // Contract Addresses - VERIFIED from imported-configs/base-tbtc-relayer-2.env
  l1ContractAddress: '0x186D048097c7406C64EfB0537886E3CaE100a1fe', // L1BitcoinDepositor on Ethereum (backup) ✅ VERIFIED
  l2ContractAddress: '0xa2A81d9445b4F898b028c96D164bcd6c8C8C512E', // L2BitcoinDepositor on Base (BaseWormholeGateway) ✅ VERIFIED
  vaultAddress: TBTC_VAULT_MAINNET, // TBTCVault on Ethereum ✅ VERIFIED

  // Wormhole Configuration - RESEARCHED from Wormhole docs (see plan.md)
  l2WormholeGatewayAddress: WORMHOLE_GATEWAYS.BASE, // Wormhole Gateway on Base ✅ RESEARCHED
  l2WormholeChainId: WORMHOLE_CHAIN_IDS.BASE, // ✅ RESEARCHED - Base Wormhole Chain ID

  // Feature Flags - Backup instance defaults (typically disabled)
  useEndpoint: FEATURE_FLAGS.USE_ENDPOINT, // Use direct blockchain listeners for better reliability
  enableL2Redemption: FEATURE_FLAGS.ENABLE_L2_REDEMPTION_BACKUP, // Backup instance - disable minter functionality to prevent conflicts
};
