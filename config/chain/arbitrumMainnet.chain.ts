import { z } from 'zod';
import { NETWORK, CHAIN_TYPE } from '../schemas/common.schema.js';
import type { EvmChainConfigSchema } from '../schemas/evm.chain.schema.js';
import { getEnv, getEnvNumber } from '../../utils/Env.js';
import {
  WORMHOLE_CHAIN_IDS,
  WORMHOLE_GATEWAYS,
  PUBLIC_RPCS,
  PUBLIC_WS_RPCS,
  commonChainInput,
} from './common.chain.js';

type EvmChainInput = z.input<typeof EvmChainConfigSchema>;

export const arbitrumMainnetChainInput: EvmChainInput = {
  ...commonChainInput,

  // Override or define chain-specific values
  chainName: 'ArbitrumMainnet',
  chainType: CHAIN_TYPE.EVM,
  network: NETWORK.MAINNET, // Ensures it uses Mainnet values from commonChainInput lookups

  privateKey: getEnv('CHAIN_ARBITRUMMAINNET_PRIVATE_KEY'),

  // l1Rpc is inherited from commonChainInput
  // l1ContractAddress is inherited from commonChainInput (L1_CONTRACT_ADDRESSES[NETWORK.MAINNET])

  l2Rpc: getEnv('CHAIN_ARBITRUMMAINNET_L2_RPC', PUBLIC_RPCS['arbitrum-one']),
  l2WsRpc: getEnv('CHAIN_ARBITRUMMAINNET_L2_WS_RPC', PUBLIC_WS_RPCS['arbitrum-one']),

  l2StartBlock: getEnvNumber('CHAIN_ARBITRUMMAINNET_L2_START_BLOCK', 247865814),
  // l1Confirmations is inherited but can be overridden if needed via CHAIN_ARBITRUMMAINNET_L1_CONFIRMATIONS
  l1Confirmations: getEnvNumber(
    'CHAIN_ARBITRUMMAINNET_L1_CONFIRMATIONS',
    commonChainInput.l1Confirmations, // Default to value from commonChainInput
  ),
  // vaultAddress is inherited from commonChainInput

  l2ContractAddress: '0x1C8d7b744b474c080faADd5BF9AD965Be4258F9e',

  l2WormholeGatewayAddress: WORMHOLE_GATEWAYS.ARBITRUM_ONE,
  l2WormholeChainId: WORMHOLE_CHAIN_IDS.ARBITRUM_ONE,

  // useEndpoint and enableL2Redemption are inherited from commonChainInput
};
