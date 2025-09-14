import { z } from 'zod';
import { NETWORK, CHAIN_TYPE } from '../schemas/common.schema.js';
import type { EvmChainConfigSchema } from '../schemas/evm.chain.schema.js';
import { getEnv, getEnvNumber } from '../../utils/Env.js';
import {
  PUBLIC_RPCS,
  PUBLIC_WS_RPCS,
  WORMHOLE_CHAIN_IDS,
  WORMHOLE_GATEWAYS,
  getCommonChainInput,
} from './common.chain.js';
import type { CommonChainInput } from '../schemas/common.schema.js';

type EvmChainInput = z.input<typeof EvmChainConfigSchema>;

export const getBaseSepoliaChainInput = (): EvmChainInput => {
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
        `getBaseSepoliaChainInput: Missing required field '${String(field)}' in commonTestnetInput.`,
      );
    }
  }

  const config: EvmChainInput = {
    // Explicitly assign all properties from commonTestnetInput or defaults
    network: commonTestnetInput.network as NETWORK,
    vaultAddress: commonTestnetInput.vaultAddress as string,
    useEndpoint: commonTestnetInput.useEndpoint as boolean,
    supportsRevealDepositAPI:
      commonTestnetInput.supportsRevealDepositAPI === undefined
        ? false
        : commonTestnetInput.supportsRevealDepositAPI,
    endpointUrl: commonTestnetInput.endpointUrl,
    enableL2Redemption: commonTestnetInput.enableL2Redemption as boolean,
    // BaseSepolia-specific values
    chainName: 'BaseSepolia',
    chainType: CHAIN_TYPE.EVM,

    privateKey: getEnv('CHAIN_BASE_SEPOLIA_PRIVATE_KEY'),

    l1Confirmations: getEnvNumber(
      'CHAIN_BASE_SEPOLIA_L1_CONFIRMATIONS',
      commonTestnetInput.l1Confirmations as number,
    ),

    l1Rpc: commonTestnetInput.l1Rpc as string,
    l1BitcoinDepositorStartBlock: 7592526,
    l1BitcoinDepositorAddress: '0x59FAE614867b66421b44D1Ed3461e6B6a4B50106',
    l1BitcoinRedeemerStartBlock: 8558171,
    l1BitcoinRedeemerAddress: '0xe8312BD306512c5CAD4D650df373D5597B1C697A',

    l2Rpc: getEnv('CHAIN_BASE_SEPOLIA_L2_RPC', PUBLIC_RPCS['base-sepolia']),
    l2WsRpc: getEnv('CHAIN_BASE_SEPOLIA_L2_WS_RPC', PUBLIC_WS_RPCS['base-sepolia']),
    l2BitcoinDepositorStartBlock: 21173079,
    l2BitcoinDepositorAddress: '0xDEbD9aA9BC4845c7Cd2d9a997F82A2Daea540bD5',
    l2BitcoinRedeemerStartBlock: 27135404,
    l2BitcoinRedeemerAddress: '0x3e765ebafC46d8b71b798eeDd51e95381E474168',
    l2WormholeGatewayAddress: WORMHOLE_GATEWAYS.BASE_SEPOLIA,
    l2WormholeChainId: WORMHOLE_CHAIN_IDS.BASE_SEPOLIA,
  };
  return config;
};
