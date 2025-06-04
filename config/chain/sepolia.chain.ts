import { z } from 'zod';
import { NETWORK, CHAIN_TYPE } from '../schemas/common.schema.js';
import type { EvmChainConfigSchema } from '../schemas/evm.chain.schema.js';
import { getEnv, getEnvNumber } from '../../utils/Env.js';
import { getCommonChainInput, PUBLIC_RPCS, PUBLIC_WS_RPCS } from './common.chain.js';
import type { CommonChainInput } from '../schemas/common.schema.js';

type EvmChainInput = z.input<typeof EvmChainConfigSchema>;

// Generic Sepolia Testnet Configuration
// Assumes Sepolia acts as both L1 and L2 for testing purposes, or is the primary L2 context.
export const getSepoliaTestnetChainInput = (): EvmChainInput => {
  const commonTestnetInput = getCommonChainInput(NETWORK.TESTNET);

  // Validate required properties from commonTestnetInput
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
      (commonTestnetInput[field] === undefined || commonTestnetInput[field] === null)
    ) {
      throw new Error(
        `getSepoliaTestnetChainInput: Missing required field '${String(field)}' in commonTestnetInput.`,
      );
    }
  }

  const config: EvmChainInput = {
    network: commonTestnetInput.network as NETWORK,
    l1Rpc: commonTestnetInput.l1Rpc as string,
    vaultAddress: commonTestnetInput.vaultAddress as string,
    l1ContractAddress: commonTestnetInput.l1ContractAddress as string,
    l1Confirmations: commonTestnetInput.l1Confirmations as number,
    enableL2Redemption: commonTestnetInput.enableL2Redemption as boolean,
    useEndpoint: commonTestnetInput.useEndpoint as boolean,
    // supportsRevealDepositAPI is optional in CommonChainConfigSchema, defaults to false
    supportsRevealDepositAPI:
      commonTestnetInput.supportsRevealDepositAPI === undefined
        ? false
        : commonTestnetInput.supportsRevealDepositAPI,
    // endpointUrl is optional
    endpointUrl: commonTestnetInput.endpointUrl,

    // Sepolia-specific overrides and additions
    chainName: 'SepoliaTestnet',
    chainType: CHAIN_TYPE.EVM,
    privateKey: getEnv('CHAIN_SEPOLIATESTNET_PRIVATE_KEY'),
    l2Rpc: getEnv('ETHEREUM_SEPOLIA_RPC', PUBLIC_RPCS['ethereum-sepolia']),
    l2WsRpc: getEnv('ETHEREUM_SEPOLIA_WS_RPC', PUBLIC_WS_RPCS['ethereum-sepolia']),
    l2StartBlock: getEnvNumber('CHAIN_SEPOLIATESTNET_L2_START_BLOCK', 0),
    l2ContractAddress: getEnv('CHAIN_SEPOLIATESTNET_L2_CONTRACT_ADDRESS'),
    l2WormholeGatewayAddress: getEnv('CHAIN_SEPOLIATESTNET_WORMHOLE_GATEWAY'),
    l2WormholeChainId: getEnvNumber('CHAIN_SEPOLIATESTNET_WORMHOLE_CHAIN_ID'),
  };
  return config;
};
