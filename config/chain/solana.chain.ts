import { z } from 'zod';
import { CHAIN_TYPE, NETWORK } from '../schemas/common.schema';
import type { SolanaChainConfigSchema } from '../schemas/solana.chain.schema';
import { getEnv } from '../../utils/Env';
import { commonChainInput } from './common.chain';

type SolanaChainInput = z.input<typeof SolanaChainConfigSchema>;

export const solanaDevnetChainInput: SolanaChainInput = {
  ...commonChainInput,

  // Overrides
  chainName: 'SolanaDevnet',
  chainType: CHAIN_TYPE.SOLANA,
  network: NETWORK.DEVNET,

  // Required by SolanaChainBaseSchema
  solanaPrivateKey: getEnv('CHAIN_SOLANADEVNET_PRIVATE_KEY'),
  solanaCommitment: 'confirmed',
};
