import { z } from 'zod';
import { NETWORK, CHAIN_TYPE } from '../schemas/common.schema.js';
import type { EvmChainConfigSchema } from '../schemas/evm.chain.schema.js';
import { getEnv, getEnvNumber } from '../../utils/Env.js';
import { getCommonChainInput, PUBLIC_RPCS, PUBLIC_WS_RPCS } from './common.chain.js';

type EvmChainInput = z.input<typeof EvmChainConfigSchema>;

// Generic Sepolia Testnet Configuration
// Assumes Sepolia acts as both L1 and L2 for testing purposes, or is the primary L2 context.
export const getSepoliaTestnetChainInput = (): EvmChainInput => {
  const commonTestnetInput = getCommonChainInput(NETWORK.TESTNET);

  const config: EvmChainInput = {
    // Fields from commonTestnetInput (explicitly assigned)
    network: commonTestnetInput.network!,
    l1Rpc: commonTestnetInput.l1Rpc!,
    vaultAddress: commonTestnetInput.vaultAddress!,
    l1ContractAddress: commonTestnetInput.l1ContractAddress!,
    l1Confirmations: commonTestnetInput.l1Confirmations!,
    enableL2Redemption: commonTestnetInput.enableL2Redemption!,
    useEndpoint: commonTestnetInput.useEndpoint!,
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
    l2ContractAddress: getEnv(
      'CHAIN_SEPOLIATESTNET_L2_CONTRACT_ADDRESS',
      '0x2222222222222222222222222222222222222222',
    ),
    l2WormholeGatewayAddress: getEnv(
      'CHAIN_SEPOLIATESTNET_WORMHOLE_GATEWAY',
      '0xMockSepoliaWormholeGateway00000000000000',
    ),
    l2WormholeChainId: getEnvNumber('CHAIN_SEPOLIATESTNET_WORMHOLE_CHAIN_ID', 10002),
  };
  return config;
};
