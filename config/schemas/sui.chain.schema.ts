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

const CommonConfigForSui = CommonChainConfigSchema.omit({ privateKey: true });

export const SuiChainConfigSchema = CommonConfigForSui.merge(SuiChainBaseSchema)
  .extend({
    chainType: SuiChainBaseSchema.shape.chainType,
    chainName: SuiChainBaseSchema.shape.chainName,
    suiPrivateKey: SuiChainBaseSchema.shape.suiPrivateKey,
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
