import { z } from 'zod';
import { CHAIN_TYPE } from './common.schema';
import { CommonChainConfigSchema } from './common.schema';

// Base schema for fields that are specific to Starknet chains.
const StarknetChainBaseSchema = z.object({
  chainName: z.string().default('Starknet'),
  chainType: z.literal(CHAIN_TYPE.STARKNET).default(CHAIN_TYPE.STARKNET),
  // Starknet-specific fields
  starknetPrivateKey: z
    .string()
    .min(1, 'starknetPrivateKey must not be empty if provided')
    .optional(),
  l1FeeAmountWei: z
    .string()
    .regex(/^\d+$/, 'l1FeeAmountWei must be a string of digits')
    .default('0'),
});

const CommonConfigForStarknet = CommonChainConfigSchema.omit({ privateKey: true });

export const StarknetChainConfigSchema = CommonConfigForStarknet.merge(StarknetChainBaseSchema)
  .extend({
    chainType: StarknetChainBaseSchema.shape.chainType,
    chainName: StarknetChainBaseSchema.shape.chainName,
    starknetPrivateKey: StarknetChainBaseSchema.shape.starknetPrivateKey,
    l1FeeAmountWei: StarknetChainBaseSchema.shape.l1FeeAmountWei,
  })
  .refine((data) => data.chainType === CHAIN_TYPE.STARKNET, {
    message: 'Chain type must be Starknet for StarknetChainConfigSchema.',
    path: ['chainType'],
  });

export type StarknetChainConfig = z.infer<typeof StarknetChainConfigSchema>;
