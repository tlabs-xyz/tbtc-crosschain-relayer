import { z } from 'zod';
import { NETWORK, CHAIN_TYPE } from '../schemas/common.schema.js';
import type { SuiChainConfigSchema } from '../schemas/sui.chain.schema.js';
import { getEnv, getEnvNumber } from '../../utils/Env.js';
import {
  L1_CONTRACT_ADDRESSES,
  VAULT_ADDRESSES,
  L1_CONFIRMATIONS,
  FEATURE_FLAGS,
  PUBLIC_RPCS,
} from './common.chain.js';
import { suiCommonInput } from './sui-common.js'; // Import new Sui common input

type SuiChainInput = z.input<typeof SuiChainConfigSchema>;

// Generic Sui Testnet Configuration
export const suiTestnetChainInput: SuiChainInput = {
  ...suiCommonInput, // Spread Sui common defaults
  chainType: CHAIN_TYPE.SUI, // Explicitly set chainType to satisfy TypeScript

  // == Chain Identity & Network Type (Overrides specific to this instance) ==
  chainName: 'SuiTestnet',
  network: NETWORK.TESTNET, // Explicitly Testnet

  // == RPC Configuration (Overrides) ==
  l1Rpc: getEnv('ETHEREUM_SEPOLIA_RPC', PUBLIC_RPCS['ethereum-sepolia']),
  l2Rpc: getEnv('CHAIN_SUITESTNET_L2_RPC'),
  l2WsRpc: getEnv('CHAIN_SUITESTNET_L2_WS_RPC', ''),

  // == Block Configuration (Overrides) ==
  l2StartBlock: getEnvNumber('CHAIN_SUITESTNET_L2_START_BLOCK', 0),
  l1Confirmations: L1_CONFIRMATIONS.TESTNET,

  // == Contract Addresses (Overrides using Testnet values) ==
  l1ContractAddress: L1_CONTRACT_ADDRESSES[NETWORK.TESTNET],
  vaultAddress: VAULT_ADDRESSES[NETWORK.TESTNET],
  l2ContractAddress: getEnv(
    'CHAIN_SUITESTNET_L2_CONTRACT_ADDRESS',
    '0xSuiPackageId::module::Struct',
  ), // Default placeholder added

  // == Wormhole Configuration (Placeholders/Defaults) ==
  l2WormholeGatewayAddress: getEnv(
    'CHAIN_SUITESTNET_WORMHOLE_GATEWAY',
    '0x00mockSuiWormholeGateway000000000000000000000000000000000000000', // Mock Sui address format
  ),
  l2WormholeChainId: getEnvNumber('CHAIN_SUITESTNET_WORMHOLE_CHAIN_ID', 21),

  // == Sui-Specific Configuration ==
  suiPrivateKey: getEnv('CHAIN_SUITESTNET_SUI_PRIVATE_KEY'),
  // Overrides suiGasObjectId from suiCommonInput if a specific ENV var is set for this instance
  suiGasObjectId: getEnv('CHAIN_SUITESTNET_SUI_GAS_OBJECT_ID', suiCommonInput.suiGasObjectId),

  // == Feature Flags (Overrides) ==
  enableL2Redemption: FEATURE_FLAGS.ENABLE_L2_REDEMPTION_TESTNET,
};
