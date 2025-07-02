import { z } from 'zod';
import { NETWORK, CHAIN_TYPE } from '../schemas/common.schema.js';
import type { EvmChainConfigSchema } from '../schemas/evm.chain.schema.js';
import { getEnv, getEnvNumber } from '../../utils/Env.js';
import { getCommonChainInput } from './common.chain.js';

type EvmChainInput = z.input<typeof EvmChainConfigSchema>;

export const getArbitrumSepoliaChainInput = (): EvmChainInput => {
  const commonTestnetInput = getCommonChainInput(NETWORK.TESTNET);

  const config: EvmChainInput = {
    // Explicitly assign all properties from commonTestnetInput or defaults
    network: commonTestnetInput.network!, // Should be NETWORK.TESTNET
    l1Rpc: commonTestnetInput.l1Rpc!,
    vaultAddress: commonTestnetInput.vaultAddress!,
    l1ContractAddress: commonTestnetInput.l1ContractAddress!,
    l1Confirmations: getEnvNumber(
      'CHAIN_ARBITRUMSEPOLIA_L1_CONFIRMATIONS',
      commonTestnetInput.l1Confirmations!,
    ),
    useEndpoint: commonTestnetInput.useEndpoint!,
    supportsRevealDepositAPI:
      commonTestnetInput.supportsRevealDepositAPI === undefined
        ? false
        : commonTestnetInput.supportsRevealDepositAPI,
    endpointUrl: commonTestnetInput.endpointUrl,

    // ArbitrumSepolia-specific values
    chainName: 'ArbitrumSepolia',
    chainType: CHAIN_TYPE.EVM,
    privateKey: getEnv('CHAIN_ARBITRUMSEPOLIA_PRIVATE_KEY'),
    l2Rpc: getEnv('CHAIN_ARBITRUMSEPOLIA_L2_RPC', 'https://sepolia-rollup.arbitrum.io/rpc'),
    l2WsRpc: getEnv('CHAIN_ARBITRUMSEPOLIA_L2_WS_RPC', 'wss://sepolia-rollup.arbitrum.io/rpc'),
    l2StartBlock: getEnvNumber('CHAIN_ARBITRUMSEPOLIA_L2_START_BLOCK', 0), // Replace with actual start block
    l2ContractAddress: '0x3fAe84586021754a1d446A488e73c5d1Fba559C0',
    l2WormholeGatewayAddress: '0x64eCDCe2185129A5c8059C5E427A7dDe5dBb4260', // Arbitrum Sepolia
    l2WormholeChainId: 10002, // Arbitrum Sepolia

    l2BitcoinRedeemerAddress: '0x3fAe84586021754a1d446A488e73c5d1Fba559C0',
    enableL2Redemption: true,
  };
  return config;
};
