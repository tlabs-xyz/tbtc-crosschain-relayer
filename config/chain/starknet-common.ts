import { CHAIN_TYPE, NETWORK } from '../schemas/common.schema.js';
import { getCommonChainInput } from './common.chain.js';
import { getEnv } from '../../utils/Env.js';
import type { PartialDeep } from 'type-fest';
import type { StarknetChainConfig } from '../schemas/starknet.chain.schema.js';

// This function provides common defaults specifically for StarkNet chains,
// building upon the universal getCommonChainInput.
export const getStarknetCommonInput = (
  targetNetwork: NETWORK,
): PartialDeep<StarknetChainConfig> => {
  const commonInput = getCommonChainInput(targetNetwork);
  return {
    ...commonInput,
    chainType: CHAIN_TYPE.STARKNET,
    // Enable reveal deposit API for StarkNet
    supportsRevealDepositAPI: true,
    // Default L1 fee amount for StarkNet transactions, can be overridden by specific ENV or config.
    l1FeeAmountWei: getEnv('STARKNET_DEFAULT_L1_FEE_AMOUNT_WEI', '0'),
    // Other StarkNet-specific common defaults can be added here
  };
};
