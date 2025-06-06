/**
 * Common chain configuration schema for cross-chain relayer.
 *
 * This file defines enums and a Zod schema for fields that are shared across all chain configurations.
 * It provides type safety, validation, and documentation for core chain config fields used throughout the system.
 *
 * Update this file to add or clarify fields that are common to all supported chains.
 */
import { z } from 'zod';
import { EthereumAddressSchema } from './shared';

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

// =====================
// Common Chain Schema
// =====================

/**
 * Common chain configuration schema for tBTC cross-chain relayer.
 * Defines fields shared by all supported chains.
 */
// This schema defines fields that are common to all chain configurations and typically have defaults.
// Specific chain schemas will merge this and can override these defaults.
export const CommonChainConfigSchema = z.object({
  /** Chain type (EVM, Starknet, Sui, Solana, etc.) */
  chainType: z.nativeEnum(CHAIN_TYPE).default(CHAIN_TYPE.EVM),
  /** Human-readable chain name */
  chainName: z.string().default('Unknown Chain'),

  /** Private key for chain operations (optional) */
  privateKey: z.string().min(1, 'privateKey must not be empty if provided').optional(),

  /** Network type (Mainnet, Testnet, Devnet) */
  network: z.nativeEnum(NETWORK).default(NETWORK.TESTNET),
  /**
   * Determines if the relayer should use HTTP endpoints for deposit processing
   * instead of direct L2 event listeners.
   * When true, L2 listeners are disabled, and routes like /api/:chainName/reveal
   * and /api/:chainName/deposit/:depositId become available.
   * Defaults to false.
   */
  useEndpoint: z.coerce.boolean().default(false),
  /** Optional: URL for the endpoint if useEndpoint is enabled */
  endpointUrl: z.string().url('endpointUrl must be a valid URL').optional(),
  /**
   * When `useEndpoint` is true, this flag specifically controls whether the
   * POST /api/:chainName/reveal endpoint is active for this chain.
   * If `useEndpoint` is true but this is false, the reveal endpoint will return a 405 error.
   * This allows enabling the general endpoint mode while selectively disabling the reveal intake.
   * Defaults to false.
   */
  supportsRevealDepositAPI: z.coerce.boolean().default(false),

  /** Enables L2 redemption functionality for this chain */
  enableL2Redemption: z.coerce.boolean().default(false),

  /** L1 RPC endpoint URL */
  l1Rpc: z.string().url('l1Rpc must be a valid URL'),
  /** L2 RPC endpoint URL */
  l2Rpc: z.string().url('l2Rpc must be a valid URL'),
  /** L2 WebSocket endpoint URL */
  l2WsRpc: z.string().url('l2WsRpc must be a valid WebSocket URL'),

  /** L1 contract address for the chain */
  l1ContractAddress: EthereumAddressSchema,
  /** L2 contract address for the chain */
  l2ContractAddress: EthereumAddressSchema,

  /** L1 Bitcoin redeemer contract address */
  l1BitcoinRedeemerAddress: EthereumAddressSchema,
  /**
   * Optional address of the L2BitcoinRedeemer contract/program.
   * Not all chains will have L2 redemption functionality, or it may be deployed
   * later than minting. Non-EVM chains, for example, might initially lack a
   * specific L2BitcoinRedeemer program while still supporting tBTC minting.
   */
  l2BitcoinRedeemerAddress: EthereumAddressSchema.optional(),

  /** L2 Wormhole gateway contract address */
  l2WormholeGatewayAddress: EthereumAddressSchema,
  /** Wormhole chain ID for L2 */
  l2WormholeChainId: z.coerce.number().int().nonnegative(),

  /** L2 start block for event scanning */
  l2StartBlock: z.coerce.number().int().nonnegative(),
  /** Vault contract address for the chain */
  vaultAddress: EthereumAddressSchema,

  /** Number of L1 block confirmations to wait for transactions. */
  l1Confirmations: z.coerce.number().int().positive().default(1),
});

export type CommonChainConfig = z.infer<typeof CommonChainConfigSchema>;
