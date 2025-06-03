import { z } from 'zod';
import { CHAIN_TYPE } from './common.schema.js';
import { CommonChainConfigSchema } from './common.schema.js';

/**
 * StarkNet address validation schema
 * StarkNet addresses are hex strings starting with 0x, up to 64 characters long
 * (excluding the 0x prefix, so 66 total including 0x)
 */
const StarkNetAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{1,64}$/, 'StarkNet address must be a valid hex string starting with 0x')
  .describe('A valid StarkNet address in hexadecimal format');

/**
 * Wei amount validation schema for L1 fee calculations
 * Must be a string representation of a positive integer (to handle BigNumber precision)
 */
const WeiAmountSchema = z
  .string()
  .regex(/^\d+$/, 'Wei amount must be a string of digits (to handle BigNumber precision)')
  .describe('Wei amount as string to preserve precision for large numbers');

/**
 * StarkNet private key validation schema
 * Must be a valid hex string for cryptographic operations
 */
const StarkNetPrivateKeySchema = z
  .string({
    required_error:
      'STARKNET_PRIVATE_KEY is required. Set it in the environment or provide it in the config data.',
  })
  .min(1, 'STARKNET_PRIVATE_KEY must not be empty.')
  .regex(
    /^0x[0-9a-fA-F]{64}$/,
    'StarkNet private key must be a 64-character hex string with 0x prefix',
  )
  .describe('StarkNet private key for L2 account access');

// Base schema for fields that are specific to Starknet chains.
const StarknetChainBaseSchema = z.object({
  chainName: z.string().default('Starknet'),
  chainType: z.literal(CHAIN_TYPE.STARKNET).default(CHAIN_TYPE.STARKNET),

  // StarkNet-specific L2 configuration
  starknetPrivateKey: StarkNetPrivateKeySchema,
  starknetDeployerAddress: StarkNetAddressSchema.describe(
    'StarkNet deployer address for L2 account initialization',
  ),
  l1FeeAmountWei: WeiAmountSchema.default('0').describe(
    'L1 fee amount in Wei for StarkNet L1-to-L2 messaging',
  ),
});

// Combine common chain config (without privateKey) with StarkNet-specific fields
const CommonConfigForStarknet = CommonChainConfigSchema.omit({ privateKey: true });

export const StarknetChainConfigSchema = CommonConfigForStarknet.merge(StarknetChainBaseSchema)
  .refine((data) => data.chainType === CHAIN_TYPE.STARKNET, {
    message: 'Chain type must be STARKNET for StarknetChainConfigSchema.',
    path: ['chainType'],
  })
  .refine((data) => !!data.starknetPrivateKey, {
    message: 'starknetPrivateKey is required for StarkNet chains.',
    path: ['starknetPrivateKey'],
  })
  .refine((data) => !!data.starknetDeployerAddress, {
    message: 'starknetDeployerAddress is required for StarkNet chains.',
    path: ['starknetDeployerAddress'],
  })
  .describe('Complete configuration schema for StarkNet chain handlers');

export type StarknetChainConfig = z.infer<typeof StarknetChainConfigSchema>;
