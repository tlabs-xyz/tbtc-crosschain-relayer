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

export const getBaseMainnetChainInput = (): EvmChainInput => {
  const commonMainnetInput = getCommonChainInput(NETWORK.MAINNET);

  const config: EvmChainInput = {
    // Explicitly assign all properties from commonMainnetInput or defaults
    network: commonMainnetInput.network!, // Should be NETWORK.MAINNET
    l1Rpc: commonMainnetInput.l1Rpc!,
    vaultAddress: commonMainnetInput.vaultAddress!,
    l1ContractAddress: commonMainnetInput.l1ContractAddress!,
    l1Confirmations: getEnvNumber(
      'CHAIN_BASEMAINNET_L1_CONFIRMATIONS',
      commonMainnetInput.l1Confirmations!, // Default to value from commonMainnetInput
    ),
    enableL2Redemption: commonMainnetInput.enableL2Redemption!,
    useEndpoint: commonMainnetInput.useEndpoint!,
    supportsRevealDepositAPI:
      commonMainnetInput.supportsRevealDepositAPI === undefined
        ? false
        : commonMainnetInput.supportsRevealDepositAPI,
    endpointUrl: commonMainnetInput.endpointUrl,

    // BaseMainnet-specific values
    chainName: 'BaseMainnet',
    chainType: CHAIN_TYPE.EVM,
    privateKey: getEnv('CHAIN_BASEMAINNET_PRIVATE_KEY'),
    l2Rpc: getEnv('CHAIN_BASEMAINNET_L2_RPC', PUBLIC_RPCS['base-mainnet']),
    l2WsRpc: getEnv('CHAIN_BASEMAINNET_L2_WS_RPC', PUBLIC_WS_RPCS['base-mainnet']),
    l2StartBlock: getEnvNumber('CHAIN_BASEMAINNET_L2_START_BLOCK', 26922966),
    l2ContractAddress: '0xa2A81d9445b4F898b028c96D164bcd6c8C8C512E',
    l2WormholeGatewayAddress: WORMHOLE_GATEWAYS.BASE,
    l2WormholeChainId: WORMHOLE_CHAIN_IDS.BASE,
  };
  return config;
};
