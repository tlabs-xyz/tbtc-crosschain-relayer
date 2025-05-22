import { z } from 'zod';
import { NETWORK } from '../schemas/chain.common.schema.js';
import type { EvmChainConfigSchema } from '../schemas/evm.chain.schema.js';
import { commonChainInput } from './common.chain.js';
import { CHAIN_TYPE } from '../schemas/chain.common.schema.js';
import { getEnv } from '../../utils/Env.js';

type EvmChainInput = z.input<typeof EvmChainConfigSchema>;

export const sepoliaTestnetChainInput: EvmChainInput = {
  ...commonChainInput,

  // Overrides
  chainName: 'SepoliaTestnet',
  chainType: CHAIN_TYPE.EVM,
  network: NETWORK.TESTNET,
  privateKey: getEnv('CHAIN_SEPOLIATESTNET_PRIVATE_KEY'),
};
