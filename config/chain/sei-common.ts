import { CHAIN_TYPE, NETWORK } from '../schemas/common.schema.js';
import { getCommonChainInput, SEI_L1_CONTRACT_ADDRESSES, SEI_L2_TOKEN_ADDRESSES } from './common.chain.js';
import { getEnv } from '../../utils/Env.js';
import type { PartialDeep } from 'type-fest';
import type { SeiChainConfig } from '../schemas/sei.chain.schema.js';

// This function provides common defaults specifically for Sei chains,
// building upon the universal getCommonChainInput.
export const getSeiCommonInput = (
  targetNetwork: NETWORK,
): PartialDeep<SeiChainConfig> => {
  const commonInput = getCommonChainInput(targetNetwork);
  return {
    ...commonInput,
    chainType: CHAIN_TYPE.SEI,
    l1BitcoinDepositorAddress: SEI_L1_CONTRACT_ADDRESSES[targetNetwork],
    // Enable reveal deposit API for Sei (NTT pattern with L1 depositor)
    supportsRevealDepositAPI: true,
    // L2 token address on Sei EVM network (Sei EVM Chain ID: 1329 for mainnet, but we don't use native chain ID here)
    l2TokenAddress: SEI_L2_TOKEN_ADDRESSES[targetNetwork],
    // Wormhole Chain ID for Sei: 40 (used for cross-chain messaging via Wormhole)
    // NOTE: This is NOT the same as Sei EVM's native Chain ID (1329 for Pacific-1 mainnet)
    wormholeChainId: 40,
    // Other Sei-specific common defaults can be added here
  };
};

