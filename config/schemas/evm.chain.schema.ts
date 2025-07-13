import { z } from 'zod';
import { CHAIN_TYPE, CommonChainConfigSchema } from './common.schema.js';
import { getPrivateKeyPattern } from '../constants/privateKeyPatterns.js';

const EvmChainBaseSchema = z.object({
  chainType: z.literal(CHAIN_TYPE.EVM).default(CHAIN_TYPE.EVM), // Fixed for EVM chains
});

export const EvmChainConfigSchema = EvmChainBaseSchema.merge(CommonChainConfigSchema)
  .extend({
    chainType: EvmChainBaseSchema.shape.chainType,
  })
  .refine((data) => data.chainType === CHAIN_TYPE.EVM, {
    message: 'Chain type must be EVM for EvmChainConfigSchema.',
    path: ['chainType'],
  })
  .refine(
    (data) => {
      // Validate privateKey format using shared pattern
      if (data.privateKey) {
        const pattern = getPrivateKeyPattern(CHAIN_TYPE.EVM);
        return pattern ? pattern.pattern.test(data.privateKey) : false;
      }
      return false; // privateKey is required by CommonChainConfigSchema
    },
    {
      message: (() => {
        const pattern = getPrivateKeyPattern(CHAIN_TYPE.EVM);
        return pattern ? `EVM private key must be: ${pattern.description}` : 'Invalid EVM private key format.';
      })(),
      path: ['privateKey'],
    },
  );

export type EvmChainConfig = z.infer<typeof EvmChainConfigSchema>;
