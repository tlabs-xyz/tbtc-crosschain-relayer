import { CHAIN_TYPE } from '../schemas/common.schema.js';
import { commonChainInput } from './common.chain.js';
import { getEnv } from '../../utils/Env.js';

// This object provides common defaults specifically for Sui chains,
// building upon the universal commonChainInput.
// It is not meant to be a fully valid SuiChainInput on its own, as it lacks
// instance-specific details like suiPrivateKey, which must be provided by
// concrete Sui chain configurations.
export const suiCommonInput = {
  ...commonChainInput,
  chainType: CHAIN_TYPE.SUI,
  // Default Gas Object ID for Sui transactions, optional. Can be overridden by specific ENV or config.
  suiGasObjectId: getEnv('SUI_DEFAULT_GAS_OBJECT_ID', ''),
};
