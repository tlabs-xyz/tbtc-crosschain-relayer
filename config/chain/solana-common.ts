import { CHAIN_TYPE } from '../schemas/common.schema.js';
import { commonChainInput } from './common.chain.js';

// This object provides common defaults specifically for Solana chains,
// building upon the universal commonChainInput.
// It is not meant to be a fully valid SolanaChainInput on its own, as it lacks
// instance-specific details like solanaPrivateKey, which must be provided by
// concrete Solana chain configurations.
export const solanaCommonInput = {
  ...commonChainInput,
  chainType: CHAIN_TYPE.SOLANA,
  solanaCommitment: 'confirmed' as const, // Default commitment level for Solana transactions
};
