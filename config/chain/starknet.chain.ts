import { z } from 'zod';
import { NETWORK } from '../schemas/common.schema.js';
import type { StarknetChainConfigSchema } from '../schemas/starknet.chain.schema.js';
import { getEnv, getEnvNumber } from '../../utils/Env.js';
import { getStarknetCommonInput } from './starknet-common.js';

type StarknetChainInput = z.input<typeof StarknetChainConfigSchema>;

// Generic StarkNet Testnet Configuration
export const getStarknetTestnetChainInput = (): StarknetChainInput => {
  const commonTestnetStarknetInput = getStarknetCommonInput(NETWORK.TESTNET);

  const config: StarknetChainInput = {
    network: commonTestnetStarknetInput.network!,
    chainType: commonTestnetStarknetInput.chainType!,
    l1Rpc: commonTestnetStarknetInput.l1Rpc!,
    vaultAddress: commonTestnetStarknetInput.vaultAddress!,
    l1ContractAddress: commonTestnetStarknetInput.l1ContractAddress!,
    l1Confirmations: commonTestnetStarknetInput.l1Confirmations!,
    enableL2Redemption: commonTestnetStarknetInput.enableL2Redemption!,
    useEndpoint: commonTestnetStarknetInput.useEndpoint!,
    supportsRevealDepositAPI:
      commonTestnetStarknetInput.supportsRevealDepositAPI === undefined
        ? false
        : commonTestnetStarknetInput.supportsRevealDepositAPI,
    endpointUrl: commonTestnetStarknetInput.endpointUrl,
    l1FeeAmountWei: getEnv(
      'CHAIN_STARKNETTESTNET_L1_FEE_AMOUNT_WEI',
      commonTestnetStarknetInput.l1FeeAmountWei!,
    ),

    chainName: 'StarknetTestnet',
    l2Rpc: getEnv('CHAIN_STARKNETTESTNET_L2_RPC'),
    l2WsRpc: getEnv('CHAIN_STARKNETTESTNET_L2_WS_RPC', ''),
    l2StartBlock: getEnvNumber('CHAIN_STARKNETTESTNET_L2_START_BLOCK', 0),
    l2ContractAddress: getEnv(
      'CHAIN_STARKNETTESTNET_L2_CONTRACT_ADDRESS',
      '0xc2fe2522A5673E56da0D6b754b2d5cA3E9e3e64B',
    ),
    l2WormholeGatewayAddress: getEnv('CHAIN_STARKNETTESTNET_WORMHOLE_GATEWAY', 'StarkNetNAGateway'),
    l2WormholeChainId: getEnvNumber('CHAIN_STARKNETTESTNET_WORMHOLE_CHAIN_ID', 0),
    starknetPrivateKey: getEnv('CHAIN_STARKNETTESTNET_STARKNET_PRIVATE_KEY'),
  };
  return config;
};
