import { z } from 'zod';
import { CHAIN_TYPE } from './common.schema.js';
import { CommonChainConfigSchema } from './common.schema.js';

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
  solanaSignerKeyBase: z.string().optional(),
});

const CommonConfigForSolana = CommonChainConfigSchema.omit({ privateKey: true });

export const SolanaChainConfigSchema = CommonConfigForSolana.merge(SolanaChainBaseSchema)
  .extend({
    chainType: SolanaChainBaseSchema.shape.chainType,
    chainName: SolanaChainBaseSchema.shape.chainName,
    solanaPrivateKey: SolanaChainBaseSchema.shape.solanaPrivateKey,
  })
  .refine((data) => data.chainType === CHAIN_TYPE.SOLANA, {
    message: 'Chain type must be Solana for SolanaChainConfigSchema.',
    path: ['chainType'],
  })
  .refine((data) => !!data.solanaPrivateKey, {
    message: 'solanaPrivateKey is required for Solana chains.',
    path: ['solanaPrivateKey'],
  });

export type SolanaChainConfig = z.infer<typeof SolanaChainConfigSchema>;
