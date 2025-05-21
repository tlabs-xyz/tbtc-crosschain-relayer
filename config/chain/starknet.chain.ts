import { z } from 'zod';
import { CHAIN_TYPE, NETWORK } from '../schemas/chain.common.schema.js';
import type { StarknetChainConfigSchema } from '../schemas/starknet.chain.schema.js';
import { commonChainInput } from './common.chain.js';
import { getEnv } from '../../utils/Env.js';

type StarknetChainInput = z.input<typeof StarknetChainConfigSchema>;

export const starknetTestnetChainInput: StarknetChainInput = {
  ...commonChainInput,

  // Overrides for Starknet
  chainName: 'StarknetTestnet',
  chainType: CHAIN_TYPE.STARKNET,
  network: NETWORK.TESTNET,

  // Required by StarknetChainBaseSchema
  starknetPrivateKey: getEnv('CHAIN_STARKNETTESTNET_PRIVATE_KEY'),
};
