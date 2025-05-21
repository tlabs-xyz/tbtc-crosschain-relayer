import { z } from 'zod';
import { CHAIN_TYPE } from './chain.common.schema.js';
import { CommonChainConfigSchema } from './chain.common.schema.js';

// Base schema for fields that are specific to Solana chains.
const SolanaChainBaseSchema = z.object({
  chainName: z.string().default('Solana'),
  chainType: z.literal(CHAIN_TYPE.SOLANA).default(CHAIN_TYPE.SOLANA),
  // Solana-specific fields, often sourced from ENV or specific to the chain instance
  solanaPrivateKey: z
    .string({
      required_error:
        'SOLANA_PRIVATE_KEY is required. Set it in the environment or provide it in the config data.',
    })
    .min(1, 'SOLANA_PRIVATE_KEY must not be empty.'),
  solanaCommitment: z.enum(['processed', 'confirmed', 'finalized']).default('confirmed'),
  solanaSignerKeyBase: z.string().optional(), // TODO: Optional?

  // TODO: Is there a better way to get rid of `privateKey` here?
  privateKey: z.string().optional(), // Unused, will be shadowed by solanaPrivateKey
});

export const SolanaChainConfigSchema = SolanaChainBaseSchema.merge(CommonChainConfigSchema)
  .extend({
    // Make sure chainType is not overridden by common
    chainType: SolanaChainBaseSchema.shape.chainType,
  })
  .refine((data) => data.chainType === CHAIN_TYPE.SOLANA, {
    message: 'Chain type must be Solana for SolanaChainConfigSchema.',
    path: ['chainType'],
  })
  .refine((data) => !!data.solanaPrivateKey, {
    message: 'solanaPrivateKey is required for Solana chains.',
    path: ['solanaPrivateKey'],
  });

// Infer the TypeScript type from the schema
export type SolanaChainConfig = z.infer<typeof SolanaChainConfigSchema>;
