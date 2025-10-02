import { z } from 'zod';
import { NETWORK, CHAIN_TYPE } from '../schemas/common.schema.js';
import type { EvmChainConfigSchema } from '../schemas/evm.chain.schema.js';
import { getEnv, getEnvNumber } from '../../utils/Env.js';
import {
  WORMHOLE_CHAIN_IDS,
  WORMHOLE_GATEWAYS,
  NTT_MANAGERS,
  NTT_MANAGER_WITH_EXECUTOR,
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
    l1ContractAddress: getEnv('CHAIN_BASESEPOLIATESTNET_L1_CONTRACT_ADDRESS', '0x0000000000000000000000000000000000000000'), // L1BTCDepositorNttWithExecutor placeholder
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
    l2StartBlock: getEnvNumber('CHAIN_BASESEPOLIATESTNET_L2_START_BLOCK', 0),
    l2ContractAddress: getEnv('CHAIN_BASESEPOLIATESTNET_L2_CONTRACT_ADDRESS', '0xc10a0886d4Fe06bD61f41ee2855a2215375B82f0'), // L2TBTC.sol Proxy
    l2WormholeGatewayAddress: WORMHOLE_GATEWAYS.BASE_SEPOLIA, // BaseSepolia Wormhole Gateway: 0x86F55A04690fd7815A3D802bD587e83eA888B239
    l2WormholeChainId: WORMHOLE_CHAIN_IDS.BASE_SEPOLIA, // BaseSepolia Wormhole chain ID = 10004
    l2NttManagerWithExecutorAddress: getEnv('CHAIN_BASESEPOLIATESTNET_L2_NTT_MANAGER_WITH_EXECUTOR', ''), // NttManagerWithExecutor placeholder for testnet
  };
  return config;
};
