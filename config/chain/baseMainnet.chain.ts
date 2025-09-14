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
    vaultAddress: commonMainnetInput.vaultAddress as string,
    useEndpoint: commonMainnetInput.useEndpoint as boolean,
    supportsRevealDepositAPI:
      commonMainnetInput.supportsRevealDepositAPI === undefined
        ? false
        : commonMainnetInput.supportsRevealDepositAPI,
    endpointUrl: commonMainnetInput.endpointUrl,
    enableL2Redemption: commonMainnetInput.enableL2Redemption as boolean,
    // BaseMainnet-specific values
    chainName: 'BaseMainnet',
    chainType: CHAIN_TYPE.EVM,

    privateKey: getEnv('CHAIN_BASE_MAINNET_PRIVATE_KEY'),

    l1Confirmations: getEnvNumber(
      'CHAIN_BASE_MAINNET_L1_CONFIRMATIONS',
      commonMainnetInput.l1Confirmations as number,
    ),

    l1Rpc: commonMainnetInput.l1Rpc as string,
    l1BitcoinDepositorStartBlock: 21961116,
    l1BitcoinDepositorAddress: '0x186D048097c7406C64EfB0537886E3CaE100a1fe',
    l1BitcoinRedeemerStartBlock: 23309400,
    l1BitcoinRedeemerAddress: '0x5D4d83aaB53B7E7cA915AEB2d4d3f4e03823DbDe',

    l2Rpc: getEnv('CHAIN_BASE_MAINNET_L2_RPC', PUBLIC_RPCS['base-mainnet']),
    l2WsRpc: getEnv('CHAIN_BASE_MAINNET_L2_WS_RPC', PUBLIC_WS_RPCS['base-mainnet']),
    l2BitcoinDepositorStartBlock: 27076231,
    l2BitcoinDepositorAddress: '0xa2A81d9445b4F898b028c96D164bcd6c8C8C512E',
    l2BitcoinRedeemerStartBlock: 35253549,
    l2BitcoinRedeemerAddress: '0xe931F1Ac6B00400E1dAD153E184afeE164d2D88B',
    l2WormholeGatewayAddress: WORMHOLE_GATEWAYS.BASE,
    l2WormholeChainId: WORMHOLE_CHAIN_IDS.BASE,
  };
  return config;
};
