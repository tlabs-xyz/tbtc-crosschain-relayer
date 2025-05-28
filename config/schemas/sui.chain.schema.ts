import { z } from 'zod';
import { CHAIN_TYPE } from './common.schema';
import { CommonChainConfigSchema } from './common.schema';

// Base schema for fields that are specific to Sui chains.
const SuiChainBaseSchema = z.object({
  chainName: z.string().default('Sui'),
  chainType: z.literal(CHAIN_TYPE.SUI).default(CHAIN_TYPE.SUI),
  // Sui-specific fields
  suiPrivateKey: z.string().min(1, 'suiPrivateKey must not be empty if provided').optional(),
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
  });

export type SuiChainConfig = z.infer<typeof SuiChainConfigSchema>;
