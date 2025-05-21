import { z } from 'zod';
import { CHAIN_TYPE } from './chain.common.schema.js';
import { CommonChainConfigSchema } from './chain.common.schema.js';

// Base schema for fields that are specific to Sui chains.
const SuiChainBaseSchema = z.object({
  chainName: z.string().default('Sui'),
  chainType: z.literal(CHAIN_TYPE.SUI).default(CHAIN_TYPE.SUI),
  // Sui-specific fields
  suiPrivateKey: z
    .string({
      required_error:
        'SUI_PRIVATE_KEY is required. Set it in the environment or provide it in the config data.',
    })
    .min(1, 'SUI_PRIVATE_KEY must not be empty.'),
  suiGasObjectId: z.string().optional(),
});

export const SuiChainConfigSchema = SuiChainBaseSchema.merge(CommonChainConfigSchema)
  .extend({
    // Ensure chainType is not overridden by common schema's default
    chainType: SuiChainBaseSchema.shape.chainType,
  })
  .refine((data) => data.chainType === CHAIN_TYPE.SUI, {
    message: 'Chain type must be Sui for SuiChainConfigSchema.',
    path: ['chainType'],
  })
  .refine((data) => !!data.suiPrivateKey, {
    message: 'suiPrivateKey is required for Sui chains.',
    path: ['suiPrivateKey'],
  });

export type SuiChainConfig = z.infer<typeof SuiChainConfigSchema>;
