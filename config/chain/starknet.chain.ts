import { type z } from 'zod';
import { CHAIN_TYPE, NETWORK } from '../schemas/common.schema.js';
import type { StarknetChainConfigSchema } from '../schemas/starknet.chain.schema.js';
import { commonChainInput } from './common.chain.js';
import { getEnvOptional } from '../../utils/Env.js';

type StarknetChainInput = z.input<typeof StarknetChainConfigSchema>;

export const starknetTestnetChainInput: StarknetChainInput = {
  ...commonChainInput,

  // Overrides for Starknet
  chainName: 'StarknetTestnet',
  chainType: CHAIN_TYPE.STARKNET,
  network: NETWORK.TESTNET,

  // Required by StarknetChainBaseSchema - use placeholders if env vars are missing
  starknetPrivateKey:
    getEnvOptional('CHAIN_STARKNETTESTNET_PRIVATE_KEY') ||
    '0x0000000000000000000000000000000000000000000000000000000000000001',
  starknetDeployerAddress:
    getEnvOptional('CHAIN_STARKNETTESTNET_DEPLOYER_ADDRESS') ||
    '0x0000000000000000000000000000000000000000000000000000000000000001',
};
