import { z } from 'zod';
import { NETWORK } from '../schemas/common.schema.js';
import type { StarknetChainConfigSchema } from '../schemas/starknet.chain.schema.js';
import { getEnv, getEnvNumber } from '../../utils/Env.js';
import { getStarknetCommonInput } from './starknet-common.js';

type StarknetChainInput = z.input<typeof StarknetChainConfigSchema>;

// Generic StarkNet Testnet Configuration
export const getStarknetTestnetChainInput = (): StarknetChainInput => {
  const commonTestnetStarknetInput = getStarknetCommonInput(NETWORK.TESTNET);

  // Validate required properties from commonTestnetStarknetInput
  const requiredFields: Array<keyof Partial<StarknetChainInput>> = [
    'network',
    'chainType',
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
      (commonTestnetStarknetInput[field] === undefined ||
        commonTestnetStarknetInput[field] === null)
    ) {
      throw new Error(
        `getStarknetTestnetChainInput: Missing required field '${String(field)}' in commonTestnetStarknetInput.`,
      );
    }
  }

  const config: StarknetChainInput = {
    network: commonTestnetStarknetInput.network as import('../schemas/common.schema.js').NETWORK,
    chainType:
      commonTestnetStarknetInput.chainType as import('../schemas/common.schema.js').CHAIN_TYPE.STARKNET,
    l1Rpc: commonTestnetStarknetInput.l1Rpc as string,
    vaultAddress: commonTestnetStarknetInput.vaultAddress as string,
    l1ContractAddress: commonTestnetStarknetInput.l1ContractAddress as string,
    l1Confirmations: commonTestnetStarknetInput.l1Confirmations as number,
    enableL2Redemption: commonTestnetStarknetInput.enableL2Redemption as boolean,
    useEndpoint: commonTestnetStarknetInput.useEndpoint as boolean,
    supportsRevealDepositAPI:
      commonTestnetStarknetInput.supportsRevealDepositAPI === undefined
        ? false
        : commonTestnetStarknetInput.supportsRevealDepositAPI,
    endpointUrl: commonTestnetStarknetInput.endpointUrl,
    l1FeeAmountWei: getEnv(
      'CHAIN_STARKNETTESTNET_L1_FEE_AMOUNT_WEI',
      commonTestnetStarknetInput.l1FeeAmountWei as string,
    ),

    chainName: 'StarknetTestnet',
    l2Rpc: getEnv('CHAIN_STARKNETTESTNET_L2_RPC', 'https://starknet-sepolia.public.blastapi.io'),
    l2WsRpc: getEnv('CHAIN_STARKNETTESTNET_L2_WS_RPC', ''),
    l2StartBlock: getEnvNumber('CHAIN_STARKNETTESTNET_L2_START_BLOCK', 0),
    l2ContractAddress: getEnv(
      'CHAIN_STARKNETTESTNET_L2_CONTRACT_ADDRESS',
      '0xc2fe2522A5673E56da0D6b754b2d5cA3E9e3e64B',
    ),
    l2WormholeGatewayAddress: getEnv(
      'CHAIN_STARKNETTESTNET_WORMHOLE_GATEWAY',
      '0x98B5e2e6a481508c24B8b6A0b3A5b6A0b3A5b6A0',
    ),
    l2WormholeChainId: getEnvNumber('CHAIN_STARKNETTESTNET_WORMHOLE_CHAIN_ID', 19),
    starknetPrivateKey: getEnv('CHAIN_STARKNETTESTNET_STARKNET_PRIVATE_KEY'),
    // L1 private key for endpoint mode (to pay for L1 transactions)
    privateKey: getEnv('CHAIN_STARKNETTESTNET_PRIVATE_KEY'),
  };
  return config;
};
