import { CHAIN_TYPE } from '../schemas/common.schema.js';
import { commonChainInput } from './common.chain.js';
import { getEnv } from '../../utils/Env.js';

// This object provides common defaults specifically for StarkNet chains,
// building upon the universal commonChainInput.
// It is not meant to be a fully valid StarknetChainInput on its own, as it lacks
// instance-specific details like starknetPrivateKey, which must be provided by
// concrete StarkNet chain configurations.
export const starknetCommonInput = {
  ...commonChainInput,
  chainType: CHAIN_TYPE.STARKNET,
  // Default L1 fee amount for StarkNet transactions, can be overridden by specific ENV or config.
  l1FeeAmountWei: getEnv('STARKNET_DEFAULT_L1_FEE_AMOUNT_WEI', '0'),
};

