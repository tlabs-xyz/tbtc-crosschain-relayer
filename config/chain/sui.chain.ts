import { type z } from 'zod';
import { CHAIN_TYPE, NETWORK } from '../schemas/common.schema.js';
import type { SuiChainConfigSchema } from '../schemas/sui.chain.schema.js';
import { commonChainInput } from './common.chain.js';
import { getEnv } from '../../utils/Env.js';

type SuiChainInput = z.input<typeof SuiChainConfigSchema>;

export const suiTestnetChainInput: SuiChainInput = {
  ...commonChainInput,

  // Overrides for Sui
  chainName: 'SuiTestnet',
  chainType: CHAIN_TYPE.SUI,
  network: NETWORK.TESTNET,

  // Required by SuiChainBaseSchema
  suiPrivateKey: getEnv('CHAIN_SUITESTNET_PRIVATE_KEY'),
};
