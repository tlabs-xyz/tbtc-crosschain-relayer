import type { PartialDeep } from 'type-fest';
import { CHAIN_TYPE, type NETWORK } from '../schemas/common.schema.js';
import type { SolanaChainConfig } from '../schemas/solana.chain.schema.js';
import { getCommonChainInput } from './common.chain.js';

// This function provides common defaults specifically for Solana chains,
// building upon the universal getCommonChainInput.
// It is not meant to be a fully valid SolanaChainInput on its own, as it lacks
// instance-specific details like solanaPrivateKey, which must be provided by
// concrete Solana chain configurations.
export const getSolanaCommonInput = (targetNetwork: NETWORK): PartialDeep<SolanaChainConfig> => {
  const commonInput = getCommonChainInput(targetNetwork);
  return {
    ...commonInput,
    chainType: CHAIN_TYPE.SOLANA,
    solanaCommitment: 'confirmed', // Default commitment level for Solana transactions
    // Other Solana-specific common defaults can be added here
  };
};
