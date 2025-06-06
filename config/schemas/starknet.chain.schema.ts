/**
 * StarkNet chain configuration schema for the cross-chain relayer.
 *
 * This file defines Zod schemas and types for validating and documenting all configuration fields
 * required for StarkNet chain integration, including L1/L2 addresses, keys, polling, and event handling.
 *
 * It merges StarkNet-specific fields with the common chain config, omitting and overriding as needed.
 * Update this file to add, deprecate, or clarify any StarkNet-specific configuration fields.
 */
import { z } from 'zod';
import { CHAIN_TYPE, CommonChainConfigSchema } from './common.schema.js';
import { EthereumAddressSchema } from './shared.js'; // For L1 addresses

/**
 * Zod schema for validating StarkNet addresses (0x-prefixed, up to 64 hex chars).
 */
const StarkNetAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{1,64}$/, 'StarkNet address must be a valid hex string starting with 0x')
  .describe('A valid StarkNet address in hexadecimal format');

/**
 * Zod schema for validating Wei amounts as strings (for L1 fee calculations).
 */
const WeiAmountSchema = z
  .string()
  .regex(/^[0-9]+$/, 'Wei amount must be a string of digits (to handle BigNumber precision)')
  .describe('Wei amount as string to preserve precision for large numbers');

/**
 * Zod schema for validating StarkNet private keys (0x-prefixed hex string).
 */
const StarkNetPrivateKeySchema = z
  .string({
    required_error:
      'STARKNET_PRIVATE_KEY is required. Set it in the environment or provide it in the config data.',
  })
  .min(1, 'STARKNET_PRIVATE_KEY must not be empty.')
  .regex(
    /^0x[0-9a-fA-F]{1,64}$/,
    'StarkNet private key must be a hex string with 0x prefix (typically 64 hex chars after 0x)',
  )
  .describe('StarkNet private key for L2 account access');

/**
 * Base schema for fields that are specific to StarkNet chains.
 * This will be merged with CommonChainConfigSchema (omitting its generic privateKey and l2ContractAddress).
 */
const StarknetChainBaseSchema = z.object({
  /** Human-readable chain name (default: 'Starknet') */
  chainName: z.string().default('Starknet'),
  /** Chain type (must be STARKNET) */
  chainType: z.literal(CHAIN_TYPE.STARKNET).default(CHAIN_TYPE.STARKNET),

  /** StarkNet-specific L2 account configuration (for relayer's L2 identity if needed) */
  starknetPrivateKey: StarkNetPrivateKeySchema,
  /** StarkNet deployer/account address for the relayer on L2. */
  starknetDeployerAddress: StarkNetAddressSchema.describe(
    'StarkNet deployer/account address for the relayer on L2.',
  ),

  /** L1 StarkGate Bridge address (EVM address on L1) */
  starkGateBridgeAddress: EthereumAddressSchema.describe(
    'The L1 EVM address of the StarkGate bridge contract.',
  ),

  /** L1 fee for StarkNet L1-to-L2 messaging (e.g. for finalizeDeposit) */
  l1FeeAmountWei: WeiAmountSchema.default('0').describe(
    'Default L1 fee amount in Wei for StarkNet L1-to-L2 messaging. Can be overridden dynamically.',
  ),

  /**
   * @deprecated Not used for the primary L1 event monitoring deposit flow.
   * This field was intended for direct L2 event monitoring which is not the current approach for StarkNet deposits.
   * Kept for potential other uses or future flows.
   */
  l2ContractAddress: StarkNetAddressSchema.optional().describe(
    '@deprecated L2 contract address for StarkNet. Not used for L1-event-driven deposit flow.',
  ),
  /**
   * @deprecated Not used for the primary L1 event monitoring deposit flow.
   * This field was intended for direct L2 event monitoring.
   */
  l2EventsContractAbi: z
    .any()
    .optional()
    .describe('@deprecated ABI for the L2 contract. Not used for L1-event-driven deposit flow.'),

  /** Optional parameters for L1 event polling */
  pollInterval: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Polling interval in milliseconds for fetching past L1 events for StarkNet deposits.',
    ),
  batchSize: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Number of L1 events/blocks to process in a single batch when checking for past StarkNet deposits.',
    ),
  maxBlockRange: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Maximum L1 block range to query for past events in a single call for StarkNet deposits.',
    ),
});

/**
 * Common config for StarkNet: omits privateKey and l2ContractAddress from the common schema,
 * as StarkNet uses its own fields for these.
 */
const CommonConfigForStarknet = CommonChainConfigSchema.omit({
  privateKey: true,
  l2ContractAddress: true, // Remove the common l2ContractAddress to use the StarkNet-specific optional one
});

/**
 * Complete configuration schema for StarkNet chain handler.
 * For tBTC deposits, this handler primarily monitors L1 events from the StarkNetBitcoinDepositor contract.
 */
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
  .refine((data) => !!data.starkGateBridgeAddress, {
    message: 'starkGateBridgeAddress (L1 StarkGate bridge) is required for StarkNet chains.',
    path: ['starkGateBridgeAddress'],
  })
  .describe(
    'Complete configuration schema for StarkNet chain handler. For tBTC deposits, this handler primarily monitors L1 events from the StarkNetBitcoinDepositor contract.',
  );

/**
 * Type representing a validated StarkNet chain config object.
 */
export type StarknetChainConfig = z.infer<typeof StarknetChainConfigSchema>;

// =====================
// Starknet Chain Schema
// =====================

/**
 * Starknet chain configuration schema for tBTC cross-chain relayer.
 * Defines all required and optional fields for Starknet chain integration.
 */
