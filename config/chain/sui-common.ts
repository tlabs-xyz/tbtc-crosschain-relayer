import { CHAIN_TYPE, NETWORK } from '../schemas/common.schema.js';
import { getCommonChainInput } from './common.chain.js';
import { getEnv } from '../../utils/Env.js';
import type { PartialDeep } from 'type-fest';
import type { SuiChainConfig } from '../schemas/sui.chain.schema.js';

// This function provides common defaults specifically for Sui chains,
// building upon the universal getCommonChainInput.
// It is not meant to be a fully valid SuiChainInput on its own, as it lacks
// instance-specific details like suiPrivateKey, which must be provided by
// concrete Sui chain configurations.
export const getSuiCommonInput = (targetNetwork: NETWORK): PartialDeep<SuiChainConfig> => {
  const commonInput = getCommonChainInput(targetNetwork);
  return {
    ...commonInput,
    chainType: CHAIN_TYPE.SUI,
    // Default Gas Object ID for Sui transactions, optional. Can be overridden by specific ENV or config.
    suiGasObjectId: getEnv('SUI_DEFAULT_GAS_OBJECT_ID', ''),
    // Other Sui-specific common defaults can be added here
  };
};
