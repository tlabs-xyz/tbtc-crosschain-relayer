import { z } from 'zod';
import { NETWORK, CHAIN_TYPE, CommonChainInput } from '../schemas/common.schema.js';
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
      (commonMainnetInput[field] === undefined || commonMainnetInput[field] === null)
    ) {
      throw new Error(
        `getBaseSepoliaTestnetChainInput: Missing required field '${String(field)}' in commonTestnetInput.`,
      );
    }
  }

  const config: EvmChainInput = {
    // Explicitly assign all properties from commonMainnetInput or defaults
    network: commonMainnetInput.network, // Should be NETWORK.MAINNET
    vaultAddress: commonMainnetInput.vaultAddress as string,
    useEndpoint: commonMainnetInput.useEndpoint as boolean,
    supportsRevealDepositAPI:
      commonMainnetInput.supportsRevealDepositAPI === undefined
        ? false
        : commonMainnetInput.supportsRevealDepositAPI,
    endpointUrl: commonMainnetInput.endpointUrl,
    enableL2Redemption: commonMainnetInput.enableL2Redemption as boolean,
    // ArbitrumMainnet-specific values
    chainName: 'ArbitrumMainnet',
    chainType: CHAIN_TYPE.EVM,

    privateKey: getEnv('CHAIN_ARBITRUM_MAINNET_PRIVATE_KEY'),

    l1Confirmations: getEnvNumber(
      'CHAIN_ARBITRUM_MAINNET_L1_CONFIRMATIONS',
      commonMainnetInput.l1Confirmations as number, // Default to value from commonMainnetInput
    ),

    l1Rpc: commonMainnetInput.l1Rpc as string,
    l1BitcoinDepositorStartBlock: 20632547,
    l1BitcoinDepositorAddress: '0x75A6e4A7C8fAa162192FAD6C1F7A6d48992c619A',
    l1BitcoinRedeemerStartBlock: 23309400,
    l1BitcoinRedeemerAddress: '0x5D4d83aaB53B7E7cA915AEB2d4d3f4e03823DbDe',

    l2Rpc: getEnv('CHAIN_ARBITRUM_MAINNET_L2_RPC', PUBLIC_RPCS['arbitrum-one']),
    l2WsRpc: getEnv('CHAIN_ARBITRUM_MAINNET_L2_WS_RPC', PUBLIC_WS_RPCS['arbitrum-one']),
    l2BitcoinDepositorStartBlock: 247865814,
    l2BitcoinDepositorAddress: '0x1C8d7b744b474c080faADd5BF9AD965Be4258F9e',
    l2BitcoinRedeemerStartBlock: 376813910,
    l2BitcoinRedeemerAddress: '0xd7Cd996a47b3293d4FEc2dBcF49692370334d9b7',
    l2WormholeGatewayAddress: WORMHOLE_GATEWAYS.ARBITRUM_ONE,
    l2WormholeChainId: WORMHOLE_CHAIN_IDS.ARBITRUM_ONE,
  };
  return config;
};
