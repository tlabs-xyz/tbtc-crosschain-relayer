import { z } from 'zod';
import { CHAIN_TYPE, CommonChainConfigSchema } from './common.schema.js';

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
    .min(1, 'SUI_PRIVATE_KEY must not be empty.')
    .regex(
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/,
      'Sui private key must be a valid base64 string.',
    )
    .refine((key) => key.length >= 32, {
      // Check for a reasonable minimum length for a base64 key
      message: 'Sui private key base64 string is too short.',
    }),
  suiGasObjectId: z.string().optional(), // Optional: Can be provided by ENV or defaults to on-chain query
});

// Omit privateKey as it's handled by suiPrivateKey
const CommonConfigForSui = CommonChainConfigSchema.omit({ privateKey: true });

export const SuiChainConfigSchema = CommonConfigForSui.merge(SuiChainBaseSchema)
  .extend({
    // Ensure these specific Sui fields are part of the final schema shape
    chainType: SuiChainBaseSchema.shape.chainType,
    chainName: SuiChainBaseSchema.shape.chainName,
    suiPrivateKey: SuiChainBaseSchema.shape.suiPrivateKey,
    suiGasObjectId: SuiChainBaseSchema.shape.suiGasObjectId,

    // Override inherited EthereumAddressSchema with a generic string for Sui addresses/IDs
    l2ContractAddress: z
      .string()
      .min(1, 'l2ContractAddress is required for Sui')
      .refine(
        (address) => {
          const parts = address.split('::');
          return parts.length >= 2 && !!parts[0];
        },
        {
          message: "Invalid l2ContractAddress format. Expected format: 'package_id::module_name'.",
        },
      ),
    l2WormholeGatewayAddress: z.string().min(1, 'l2WormholeGatewayAddress is required for Sui'),
  })
  .transform((data) => ({
    ...data,
    l2PackageId: data.l2ContractAddress.split('::')[0],
  }))
  .refine((data) => data.chainType === CHAIN_TYPE.SUI, {
    message: 'Chain type must be Sui for SuiChainConfigSchema.',
    path: ['chainType'],
  });

export type SuiChainConfig = z.infer<typeof SuiChainConfigSchema>;
