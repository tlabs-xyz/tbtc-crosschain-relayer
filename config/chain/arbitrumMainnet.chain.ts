import { z } from 'zod';
import { NETWORK, CHAIN_TYPE } from '../schemas/common.schema.js';
import type { EvmChainConfigSchema } from '../schemas/evm.chain.schema.js';
import { getEnv, getEnvNumber } from '../../utils/Env.js';
import {
  WORMHOLE_CHAIN_IDS,
  WORMHOLE_GATEWAYS,
  PUBLIC_RPCS,
  PUBLIC_WS_RPCS,
  getCommonChainInput,
} from './common.chain.js';

type EvmChainInput = z.input<typeof EvmChainConfigSchema>;

export const getArbitrumMainnetChainInput = (): EvmChainInput => {
  const commonMainnetInput = getCommonChainInput(NETWORK.MAINNET);

  const config: EvmChainInput = {
    // Explicitly assign all properties from commonMainnetInput or defaults
    network: commonMainnetInput.network!, // Should be NETWORK.MAINNET
    l1Rpc: commonMainnetInput.l1Rpc!,
    vaultAddress: commonMainnetInput.vaultAddress!,
    l1ContractAddress: commonMainnetInput.l1ContractAddress!,
    l1Confirmations: getEnvNumber(
      'CHAIN_ARBITRUMMAINNET_L1_CONFIRMATIONS',
      commonMainnetInput.l1Confirmations!, // Default to value from commonMainnetInput
    ),
    enableL2Redemption: commonMainnetInput.enableL2Redemption!,
    useEndpoint: commonMainnetInput.useEndpoint!,
    supportsRevealDepositAPI:
      commonMainnetInput.supportsRevealDepositAPI === undefined
        ? false
        : commonMainnetInput.supportsRevealDepositAPI,
    endpointUrl: commonMainnetInput.endpointUrl,

    // ArbitrumMainnet-specific values
    chainName: 'ArbitrumMainnet',
    chainType: CHAIN_TYPE.EVM,
    privateKey: getEnv('CHAIN_ARBITRUMMAINNET_PRIVATE_KEY'),
    l2Rpc: getEnv('CHAIN_ARBITRUMMAINNET_L2_RPC', PUBLIC_RPCS['arbitrum-one']),
    l2WsRpc: getEnv('CHAIN_ARBITRUMMAINNET_L2_WS_RPC', PUBLIC_WS_RPCS['arbitrum-one']),
    l2StartBlock: getEnvNumber('CHAIN_ARBITRUMMAINNET_L2_START_BLOCK', 247865814),
    l2ContractAddress: '0x1C8d7b744b474c080faADd5BF9AD965Be4258F9e',
    l2WormholeGatewayAddress: WORMHOLE_GATEWAYS.ARBITRUM_ONE,
    l2WormholeChainId: WORMHOLE_CHAIN_IDS.ARBITRUM_ONE,
  };
  return config;
};
