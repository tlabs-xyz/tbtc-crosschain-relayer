import { z } from 'zod';
import { CHAIN_TYPE } from './common.schema.js';
import { CommonChainConfigSchema } from './common.schema.js';

// Base schema for fields that are specific to Starknet chains.
const StarknetChainBaseSchema = z.object({
  chainName: z.string().default('Starknet'),
  chainType: z.literal(CHAIN_TYPE.STARKNET).default(CHAIN_TYPE.STARKNET),
  // Starknet-specific fields
  starknetPrivateKey: z
    .string({
      required_error:
        'STARKNET_PRIVATE_KEY is required. Set it in the environment or provide it in the config data.',
    })
    .min(1, 'STARKNET_PRIVATE_KEY must not be empty.'),
  l1FeeAmountWei: z
    .string()
    .regex(/^\d+$/, 'l1FeeAmountWei must be a string of digits')
    .default('0'),
  // L1 private key for chains using endpoint mode (like Solana)
  // This is the Ethereum private key used to pay for L1 transactions
  privateKey: z
    .string()
    .min(1, 'privateKey is required for endpoint mode to pay L1 transactions')
    .optional(),
});

// Omit privateKey as it's handled by starknetPrivateKey
const CommonConfigForStarknet = CommonChainConfigSchema.omit({ privateKey: true });

export const StarknetChainConfigSchema = CommonConfigForStarknet.merge(StarknetChainBaseSchema)
  .extend({
    // Ensure these specific StarkNet fields are part of the final schema shape
    chainType: StarknetChainBaseSchema.shape.chainType,
    chainName: StarknetChainBaseSchema.shape.chainName,
    starknetPrivateKey: StarknetChainBaseSchema.shape.starknetPrivateKey,
    l1FeeAmountWei: StarknetChainBaseSchema.shape.l1FeeAmountWei,
    privateKey: StarknetChainBaseSchema.shape.privateKey,

    // Override inherited EthereumAddressSchema with a generic string for StarkNet addresses
    l2ContractAddress: z.string().min(1, 'l2ContractAddress is required for StarkNet'),
    l2WormholeGatewayAddress: z
      .string()
      .min(1, 'l2WormholeGatewayAddress is required for StarkNet'),

    /**
     * L2 WebSocket RPC endpoint for the StarkNet chain.
     * IMPORTANT: This field is currently NOT USED by the `StarknetChainHandler`.
     * The L2 interaction logic for StarkNet (which might use WebSockets for event
     * monitoring or other purposes) is planned for future implementation.
     *
     * This field is included in the schema for forward compatibility and to maintain
     * structural consistency with other chain configurations.
     * It can be an empty string or a valid WebSocket URL. If a URL is provided,
     * it will be validated, but the application logic will not connect to it for StarkNet.
     */
    l2WsRpc: z.string().url('l2WsRpc must be a valid WebSocket URL').optional().or(z.literal('')),
  })
  .refine((data) => data.chainType === CHAIN_TYPE.STARKNET, {
    message: 'Chain type must be Starknet for StarknetChainConfigSchema.',
    path: ['chainType'],
  })
  .refine((data) => !!data.starknetPrivateKey, {
    message: 'starknetPrivateKey is required for Starknet chains.',
    path: ['starknetPrivateKey'],
  });

export type StarknetChainConfig = z.infer<typeof StarknetChainConfigSchema>;
