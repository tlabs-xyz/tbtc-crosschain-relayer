import { z } from 'zod';
import { CHAIN_TYPE, NETWORK } from '../schemas/common.schema';
import type { StarknetChainConfigSchema } from '../schemas/starknet.chain.schema';
import { commonChainInput } from './common.chain';
import { getEnv, getEnvOptional } from '../../utils/Env';

type StarknetChainInput = z.input<typeof StarknetChainConfigSchema>;

export const starknetTestnetChainInput: StarknetChainInput = {
  ...commonChainInput,

  // Overrides for Starknet
  chainName: 'StarknetTestnet',
  chainType: CHAIN_TYPE.STARKNET,
  network: NETWORK.TESTNET,

  // Required by StarknetChainBaseSchema
  starknetPrivateKey: getEnvOptional('CHAIN_STARKNETTESTNET_PRIVATE_KEY'),
};
