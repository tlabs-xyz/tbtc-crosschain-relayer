import { type z } from 'zod';
import { NETWORK } from '../schemas/common.schema.js';
import type { EvmChainConfigSchema } from '../schemas/evm.chain.schema.js';
import { commonChainInput } from './common.chain.js';
import { CHAIN_TYPE } from '../schemas/common.schema.js';
import { getEnvOptional } from '../../utils/Env.js';

type EvmChainInput = z.input<typeof EvmChainConfigSchema>;

export const sepoliaTestnetChainInput: EvmChainInput = {
  ...commonChainInput,

  // Overrides
  chainName: 'SepoliaTestnet',
  chainType: CHAIN_TYPE.EVM,
  network: NETWORK.TESTNET,
  privateKey:
    getEnvOptional('CHAIN_SEPOLIATESTNET_PRIVATE_KEY') ||
    '0x0000000000000000000000000000000000000000000000000000000000000001',
};
