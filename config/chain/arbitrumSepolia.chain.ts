import { z } from 'zod';
import { NETWORK, CHAIN_TYPE, CommonChainInput } from '../schemas/common.schema.js';
import type { EvmChainConfigSchema } from '../schemas/evm.chain.schema.js';
import { getEnv, getEnvNumber } from '../../utils/Env.js';
import { getCommonChainInput, WORMHOLE_CHAIN_IDS, WORMHOLE_GATEWAYS } from './common.chain.js';

type EvmChainInput = z.input<typeof EvmChainConfigSchema>;

export const getArbitrumSepoliaChainInput = (): EvmChainInput => {
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
    // Explicitly assign all properties from commonTestnetInput or defaults
    network: commonTestnetInput.network, // Should be NETWORK.TESTNET
    vaultAddress: commonTestnetInput.vaultAddress as string,
    useEndpoint: commonTestnetInput.useEndpoint as boolean,
    supportsRevealDepositAPI:
      commonTestnetInput.supportsRevealDepositAPI === undefined
        ? false
        : commonTestnetInput.supportsRevealDepositAPI,
    endpointUrl: commonTestnetInput.endpointUrl,
    enableL2Redemption: commonTestnetInput.enableL2Redemption as boolean,
    // ArbitrumSepolia-specific values
    chainName: 'ArbitrumSepolia',
    chainType: CHAIN_TYPE.EVM,

    privateKey: getEnv('CHAIN_ARBITRUM_SEPOLIA_PRIVATE_KEY'),

    l1Confirmations: getEnvNumber(
      'CHAIN_ARBITRUM_SEPOLIA_L1_CONFIRMATIONS',
      commonTestnetInput.l1Confirmations as number,
    ),

    l1Rpc: commonTestnetInput.l1Rpc as string,
    l1BitcoinDepositorStartBlock: 6281003,
    l1BitcoinDepositorAddress: '0xD9B523fb879C63b00ef14e48C98f4e3398d3BA2D',
    l1BitcoinRedeemerStartBlock: 8667161,
    l1BitcoinRedeemerAddress: '0x809E35f4C9984Ad39CD1433F50F2d8E35Ac15714',

    l2Rpc: getEnv('CHAIN_ARBITRUM_SEPOLIA_L2_RPC', 'https://sepolia-rollup.arbitrum.io/rpc'),
    l2WsRpc: getEnv('CHAIN_ARBITRUM_SEPOLIA_L2_WS_RPC', 'wss://sepolia-rollup.arbitrum.io/rpc'),
    l2BitcoinDepositorStartBlock: 62644268,
    l2BitcoinDepositorAddress: '0xB2fEC598a9374078Bb639f3d70555fc4389b7a78',
    l2BitcoinRedeemerStartBlock: 169048481,
    l2BitcoinRedeemerAddress: '0x3fAe84586021754a1d446A488e73c5d1Fba559C0',
    l2WormholeGatewayAddress: WORMHOLE_GATEWAYS.ARBITRUM_SEPOLIA,
    l2WormholeChainId: WORMHOLE_CHAIN_IDS.ARBITRUM_SEPOLIA,
  };
  return config;
};
