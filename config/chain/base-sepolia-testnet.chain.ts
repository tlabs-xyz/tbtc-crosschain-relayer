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

export const getBaseSepoliaTestnetChainInput = (): EvmChainInput => {
  const commonTestnetInput = getCommonChainInput(NETWORK.TESTNET);

  // Validate required properties from commonTestnetInput
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
      (commonTestnetInput[field] === undefined || commonTestnetInput[field] === null)
    ) {
      throw new Error(
        `getBaseSepoliaTestnetChainInput: Missing required field '${String(field)}' in commonTestnetInput.`,
      );
    }
  }

  const config: EvmChainInput = {
    network: commonTestnetInput.network as NETWORK,
    l1Rpc: commonTestnetInput.l1Rpc as string,
    vaultAddress: commonTestnetInput.vaultAddress as string,
    l1ContractAddress: '0x59FAE614867b66421b44D1Ed3461e6B6a4B50106',
    l1Confirmations: getEnvNumber(
      'CHAIN_BASESEPOLIATESTNET_L1_CONFIRMATIONS',
      commonTestnetInput.l1Confirmations as number,
    ),
    enableL2Redemption: commonTestnetInput.enableL2Redemption as boolean,
    useEndpoint: commonTestnetInput.useEndpoint as boolean,
    supportsRevealDepositAPI:
      commonTestnetInput.supportsRevealDepositAPI === undefined
        ? false
        : commonTestnetInput.supportsRevealDepositAPI,
    endpointUrl: commonTestnetInput.endpointUrl,

    chainName: 'BaseSepoliaTestnet',
    chainType: CHAIN_TYPE.EVM,
    privateKey: getEnv('CHAIN_BASESEPOLIATESTNET_PRIVATE_KEY'),
    l2Rpc: getEnv('CHAIN_BASESEPOLIATESTNET_L2_RPC', PUBLIC_RPCS['base-sepolia']),
    l2WsRpc: getEnv('CHAIN_BASESEPOLIATESTNET_L2_WS_RPC', PUBLIC_WS_RPCS['base-sepolia']),
    l2StartBlock: getEnvNumber('CHAIN_BASESEPOLIATESTNET_L2_START_BLOCK', 123456),
    l2ContractAddress: '0xDEbD9aA9BC4845c7Cd2d9a997F82A2Daea540bD5',
    l2WormholeGatewayAddress: WORMHOLE_GATEWAYS.BASE_SEPOLIA,
    l2WormholeChainId: WORMHOLE_CHAIN_IDS.BASE_SEPOLIA,
  };
  return config;
};
