import { z } from 'zod';
import { CHAIN_TYPE } from './chain.common.schema.js';
import { CommonChainConfigSchema } from './chain.common.schema.js';

// Base schema for fields that are specific to Starknet chains.
const StarknetChainBaseSchema = z.object({
  chainName: z.string().default('Starknet'),
  chainType: z.literal(CHAIN_TYPE.STARKNET).default(CHAIN_TYPE.STARKNET),
  // Starknet-specific fields
  starknetPrivateKey: z
    .string({
      required_error:
        'STARKNET_PRIVATE_KEY is required. Set it in the environment or provide it in the config data.',
    })
    .min(1, 'STARKNET_PRIVATE_KEY must not be empty.'),
});

export const StarknetChainConfigSchema = StarknetChainBaseSchema.merge(CommonChainConfigSchema)
  .extend({
    // Ensure chainType is not overridden by common schema's default
    chainType: StarknetChainBaseSchema.shape.chainType,
  })
  .refine((data) => data.chainType === CHAIN_TYPE.STARKNET, {
    message: 'Chain type must be Starknet for StarknetChainConfigSchema.',
    path: ['chainType'],
  })
  .refine((data) => !!data.starknetPrivateKey, {
    message: 'starknetPrivateKey is required for Starknet chains.',
    path: ['starknetPrivateKey'],
  });

export type StarknetChainConfig = z.infer<typeof StarknetChainConfigSchema>;
