import { z } from 'zod';
import { NETWORK, CHAIN_TYPE } from '../schemas/common.schema.js';
import type { EvmChainConfigSchema } from '../schemas/evm.chain.schema.js';
import { getEnv, getEnvNumber } from '../../utils/Env.js';
import {
  commonChainInput,
  L1_CONTRACT_ADDRESSES,
  VAULT_ADDRESSES,
  L1_CONFIRMATIONS,
  FEATURE_FLAGS,
  PUBLIC_RPCS,
  PUBLIC_WS_RPCS,
} from './common.chain.js';

type EvmChainInput = z.input<typeof EvmChainConfigSchema>;

// Generic Sepolia Testnet Configuration
// Assumes Sepolia acts as both L1 and L2 for testing purposes, or is the primary L2 context.
export const sepoliaTestnetChainInput: EvmChainInput = {
  ...commonChainInput,

  // == Chain Identity & Network Type (Overrides) ==
  chainName: 'SepoliaTestnet',
  chainType: CHAIN_TYPE.EVM,
  network: NETWORK.TESTNET,

  // == Sensitive Environment Variables ==
  privateKey: getEnv('CHAIN_SEPOLIATESTNET_PRIVATE_KEY'),

  // == RPC Configuration (Overrides) ==
  // L1 is Sepolia, L2 is also Sepolia for this config
  l1Rpc: getEnv('ETHEREUM_SEPOLIA_RPC', PUBLIC_RPCS['ethereum-sepolia']),
  l2Rpc: getEnv('ETHEREUM_SEPOLIA_RPC', PUBLIC_RPCS['ethereum-sepolia']),
  l2WsRpc: getEnv('ETHEREUM_SEPOLIA_WS_RPC', PUBLIC_WS_RPCS['ethereum-sepolia']),

  // == Block Configuration (Overrides) ==
  l2StartBlock: getEnvNumber('CHAIN_SEPOLIATESTNET_L2_START_BLOCK', 0),
  l1Confirmations: L1_CONFIRMATIONS.TESTNET,

  // == Contract Addresses (Overrides using Testnet values) ==
  l1ContractAddress: L1_CONTRACT_ADDRESSES[NETWORK.TESTNET],
  vaultAddress: VAULT_ADDRESSES[NETWORK.TESTNET],
  l2ContractAddress: getEnv(
    'CHAIN_SEPOLIATESTNET_L2_CONTRACT_ADDRESS',
    '0x2222222222222222222222222222222222222222',
  ),

  // == Wormhole Configuration (Placeholders for generic Sepolia - Sepolia Wormhole ID is 10002) ==
  l2WormholeGatewayAddress: getEnv(
    'CHAIN_SEPOLIATESTNET_WORMHOLE_GATEWAY',
    '0xMockSepoliaWormholeGateway00000000000000',
  ),
  l2WormholeChainId: getEnvNumber('CHAIN_SEPOLIATESTNET_WORMHOLE_CHAIN_ID', 10002),

  // == Feature Flags (Overrides) ==
  enableL2Redemption: FEATURE_FLAGS.ENABLE_L2_REDEMPTION_TESTNET,
};
