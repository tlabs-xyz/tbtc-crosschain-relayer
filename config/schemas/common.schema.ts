import { z } from 'zod';
import { EthereumAddressSchema } from './shared.js';

export enum NETWORK {
  MAINNET = 'Mainnet',
  TESTNET = 'Testnet',
  DEVNET = 'Devnet',
}

export enum CHAIN_TYPE {
  EVM = 'Evm',
  STARKNET = 'Starknet',
  SUI = 'Sui',
  SOLANA = 'Solana',
}

// This schema defines fields that are common to all chain configurations and typically have defaults.
// Specific chain schemas will merge this and can override these defaults.
export const CommonChainConfigSchema = z.object({
  // We expect this to be overridden by the specific chain schema
  chainType: z.nativeEnum(CHAIN_TYPE).default(CHAIN_TYPE.EVM),
  chainName: z.string().default('Unknown Chain'),

  // These are optional
  privateKey: z.string().min(1, 'privateKey must not be empty if provided').optional(),

  // We expect these to remain the same for all chains
  network: z.nativeEnum(NETWORK).default(NETWORK.TESTNET),
  /**
   * Determines if the relayer should use HTTP endpoints for deposit processing
   * instead of direct L2 event listeners.
   * When true, L2 listeners are disabled, and routes like /api/:chainName/reveal
   * and /api/:chainName/deposit/:depositId become available.
   * Defaults to false.
   */
  useEndpoint: z.coerce.boolean().default(false),
  endpointUrl: z.string().url('endpointUrl must be a valid URL').optional(),
  /**
   * When `useEndpoint` is true, this flag specifically controls whether the
   * POST /api/:chainName/reveal endpoint is active for this chain.
   * If `useEndpoint` is true but this is false, the reveal endpoint will return a 405 error.
   * This allows enabling the general endpoint mode while selectively disabling the reveal intake.
   * Defaults to false.
   */
  supportsRevealDepositAPI: z.coerce.boolean().default(false),

  enableL2Redemption: z.coerce.boolean().default(false),

  l1Rpc: z.string().url('l1Rpc must be a valid URL'),
  l2Rpc: z.string().url('l2Rpc must be a valid URL'),
  l2WsRpc: z.string().url('l2WsRpc must be a valid WebSocket URL'),

  l1ContractAddress: EthereumAddressSchema,
  l2ContractAddress: EthereumAddressSchema,

  l1BitcoinRedeemerAddress: EthereumAddressSchema,
  /**
   * Optional address of the L2BitcoinRedeemer contract/program.
   * Not all chains will have L2 redemption functionality, or it may be deployed
   * later than minting. Non-EVM chains, for example, might initially lack a
   * specific L2BitcoinRedeemer program while still supporting tBTC minting.
   */
  l2BitcoinRedeemerAddress: EthereumAddressSchema.optional(),

  l2WormholeGatewayAddress: EthereumAddressSchema,
  l2WormholeChainId: z.coerce.number().int().nonnegative(),

  l2StartBlock: z.coerce.number().int().nonnegative(),
  vaultAddress: EthereumAddressSchema,

  // Number of L1 block confirmations to wait for transactions.
  l1Confirmations: z.coerce.number().int().positive().default(1),
});

export type CommonChainConfig = z.infer<typeof CommonChainConfigSchema>;
