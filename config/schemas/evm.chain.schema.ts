import { z } from 'zod';
import { CHAIN_TYPE } from './common.schema.js';
import { CommonChainConfigSchema } from './common.schema.js';

const EvmChainBaseSchema = z.object({
  chainType: z.literal(CHAIN_TYPE.EVM).default(CHAIN_TYPE.EVM), // Fixed for EVM chains
  l1Confirmations: z.coerce.number().int().positive().default(1),
});

export const EvmChainConfigSchema = EvmChainBaseSchema.merge(CommonChainConfigSchema)
  .extend({
    chainType: EvmChainBaseSchema.shape.chainType,
  })
  .refine((data) => data.chainType === CHAIN_TYPE.EVM, {
    message: 'Chain type must be EVM for EvmChainConfigSchema.',
    path: ['chainType'],
  });

export type EvmChainConfig = z.infer<typeof EvmChainConfigSchema>;
