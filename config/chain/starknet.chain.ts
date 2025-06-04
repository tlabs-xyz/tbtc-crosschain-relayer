import { z } from 'zod';
import { NETWORK, CHAIN_TYPE } from '../schemas/common.schema.js';
import type { StarknetChainConfigSchema } from '../schemas/starknet.chain.schema.js';
import { getEnv, getEnvNumber } from '../../utils/Env.js';
import {
  L1_CONTRACT_ADDRESSES,
  VAULT_ADDRESSES,
  L1_CONFIRMATIONS,
  FEATURE_FLAGS,
  PUBLIC_RPCS,
} from './common.chain.js';
import { starknetCommonInput } from './starknet-common.js'; // Import new StarkNet common input

type StarknetChainInput = z.input<typeof StarknetChainConfigSchema>;

// Generic StarkNet Testnet Configuration
export const starknetTestnetChainInput: StarknetChainInput = {
  ...starknetCommonInput, // Spread StarkNet common defaults
  chainType: CHAIN_TYPE.STARKNET, // Explicitly set chainType to satisfy TypeScript

  // == Chain Identity & Network Type (Overrides specific to this instance) ==
  chainName: 'StarknetTestnet',
  network: NETWORK.TESTNET, // Explicitly Testnet

  // == RPC Configuration (Overrides) ==
  l1Rpc: getEnv('ETHEREUM_SEPOLIA_RPC', PUBLIC_RPCS['ethereum-sepolia']),
  l2Rpc: getEnv('CHAIN_STARKNETTESTNET_L2_RPC'),
  l2WsRpc: getEnv('CHAIN_STARKNETTESTNET_L2_WS_RPC', ''),

  // == Block Configuration (Overrides) ==
  l2StartBlock: getEnvNumber('CHAIN_STARKNETTESTNET_L2_START_BLOCK', 0),
  l1Confirmations: L1_CONFIRMATIONS.TESTNET,

  // == Contract Addresses (Overrides using Testnet values) ==
  l1ContractAddress: L1_CONTRACT_ADDRESSES[NETWORK.TESTNET],
  vaultAddress: VAULT_ADDRESSES[NETWORK.TESTNET],
  l2ContractAddress: getEnv(
    'CHAIN_STARKNETTESTNET_L2_CONTRACT_ADDRESS',
    '0xc2fe2522A5673E56da0D6b754b2d5cA3E9e3e64B',
  ),

  // == Wormhole Configuration (Placeholders - StarkNet has its own L1/L2 messaging, these fields are N/A but schema-required) ==
  l2WormholeGatewayAddress: getEnv(
    'CHAIN_STARKNETTESTNET_WORMHOLE_GATEWAY',
    'StarkNetNAGateway', // N/A for StarkNet, satisfies schema
  ),
  l2WormholeChainId: getEnvNumber('CHAIN_STARKNETTESTNET_WORMHOLE_CHAIN_ID', 0), // N/A for StarkNet, using 0

  // == StarkNet-Specific Configuration ==
  starknetPrivateKey: getEnv('CHAIN_STARKNETTESTNET_STARKNET_PRIVATE_KEY'),
  // Overrides l1FeeAmountWei from starknetCommonInput if a specific ENV var is set for this instance
  l1FeeAmountWei: getEnv(
    'CHAIN_STARKNETTESTNET_L1_FEE_AMOUNT_WEI',
    starknetCommonInput.l1FeeAmountWei,
  ),

  // == Feature Flags (Overrides) ==
  enableL2Redemption: FEATURE_FLAGS.ENABLE_L2_REDEMPTION_TESTNET,
};
