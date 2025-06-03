import { type z } from 'zod';
import { CHAIN_TYPE, NETWORK } from '../schemas/common.schema.js';
import type { SuiChainConfigSchema } from '../schemas/sui.chain.schema.js';
import { commonChainInput } from './common.chain.js';
import { getEnvOptional } from '../../utils/Env.js';

type SuiChainInput = z.input<typeof SuiChainConfigSchema>;

export const suiTestnetChainInput: SuiChainInput = {
  ...commonChainInput,

  // Overrides for Sui
  chainName: 'SuiTestnet',
  chainType: CHAIN_TYPE.SUI,
  network: NETWORK.TESTNET,

  // Required by SuiChainBaseSchema - use placeholder if env var is missing
  suiPrivateKey:
    getEnvOptional('CHAIN_SUITESTNET_PRIVATE_KEY') ||
    '0000000000000000000000000000000000000000000000000000000000000001',
};
