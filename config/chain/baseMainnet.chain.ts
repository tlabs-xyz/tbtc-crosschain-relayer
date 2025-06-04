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
import type { CommonChainInput } from '../schemas/common.schema.js';

type EvmChainInput = z.input<typeof EvmChainConfigSchema>;

export const getBaseMainnetChainInput = (): EvmChainInput => {
  const commonMainnetInput = getCommonChainInput(NETWORK.MAINNET);

  // Validate required properties from commonMainnetInput
  const requiredFields: Array<keyof Partial<CommonChainInput>> = [
    'network',
    'l1Rpc',
    'vaultAddress',
    'l1ContractAddress',
    'l1Confirmations',
    'enableL2Redemption',
    'useEndpoint',
  ];
  for (const field of requiredFields) {
    if (
      typeof field === 'string' &&
      (commonMainnetInput[field] === undefined || commonMainnetInput[field] === null)
    ) {
      throw new Error(
        `getBaseMainnetChainInput: Missing required field '${String(field)}' in commonMainnetInput.`,
      );
    }
  }

  const config: EvmChainInput = {
    network: commonMainnetInput.network as NETWORK,
    l1Rpc: commonMainnetInput.l1Rpc as string,
    vaultAddress: commonMainnetInput.vaultAddress as string,
    l1ContractAddress: commonMainnetInput.l1ContractAddress as string,
    l1Confirmations: getEnvNumber(
      'CHAIN_BASEMAINNET_L1_CONFIRMATIONS',
      commonMainnetInput.l1Confirmations as number,
    ),
    enableL2Redemption: commonMainnetInput.enableL2Redemption as boolean,
    useEndpoint: commonMainnetInput.useEndpoint as boolean,
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
