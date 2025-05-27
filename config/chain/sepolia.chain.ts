import { z } from 'zod';
import { NETWORK } from '../schemas/common.schema';
import type { EvmChainConfigSchema } from '../schemas/evm.chain.schema';
import { commonChainInput } from './common.chain';
import { CHAIN_TYPE } from '../schemas/common.schema';
import { getEnv } from '../../utils/Env';

type EvmChainInput = z.input<typeof EvmChainConfigSchema>;

export const sepoliaTestnetChainInput: EvmChainInput = {
  ...commonChainInput,

  // Overrides
  chainName: 'SepoliaTestnet',
  chainType: CHAIN_TYPE.EVM,
  network: NETWORK.TESTNET,
  privateKey: getEnv('CHAIN_SEPOLIATESTNET_PRIVATE_KEY'),
};
