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

export const baseMainnetChainInput: EvmChainInput = {
  ...commonChainInput,

  // Override or define chain-specific values
  chainName: 'BaseMainnet',
  chainType: CHAIN_TYPE.EVM,
  network: NETWORK.MAINNET, // Ensures it uses Mainnet values from commonChainInput lookups

  privateKey: getEnv('CHAIN_BASEMAINNET_PRIVATE_KEY'),

  // l1Rpc is inherited from commonChainInput
  // l1ContractAddress is inherited from commonChainInput (L1_CONTRACT_ADDRESSES[NETWORK.MAINNET])

  l2Rpc: getEnv('CHAIN_BASEMAINNET_L2_RPC', PUBLIC_RPCS['base-mainnet']),
  l2WsRpc: getEnv('CHAIN_BASEMAINNET_L2_WS_RPC', PUBLIC_WS_RPCS['base-mainnet']),

  l2StartBlock: getEnvNumber('CHAIN_BASEMAINNET_L2_START_BLOCK', 26922966),
  // l1Confirmations is inherited but can be overridden if needed via CHAIN_BASEMAINNET_L1_CONFIRMATIONS
  l1Confirmations: getEnvNumber(
    'CHAIN_BASEMAINNET_L1_CONFIRMATIONS',
    commonChainInput.l1Confirmations, // Default to value from commonChainInput
  ),
  // vaultAddress is inherited from commonChainInput

  l2ContractAddress: '0xa2A81d9445b4F898b028c96D164bcd6c8C8C512E',

  l2WormholeGatewayAddress: WORMHOLE_GATEWAYS.BASE,
  l2WormholeChainId: WORMHOLE_CHAIN_IDS.BASE,

  // useEndpoint and enableL2Redemption are inherited from commonChainInput
};
