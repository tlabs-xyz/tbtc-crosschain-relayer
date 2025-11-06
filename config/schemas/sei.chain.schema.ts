import { z } from 'zod';
import { CHAIN_TYPE, CommonChainConfigSchema } from './common.schema.js';
import { EthereumAddressSchema } from './shared.js';

const CommonConfigForSei = CommonChainConfigSchema.omit({
  l2BitcoinDepositorAddress: true,
  l2WormholeGatewayAddress: true,
  l2WormholeChainId: true,
  l2WsRpc: true,
  l2BitcoinDepositorStartBlock: true,
  l2BitcoinRedeemerStartBlock: true,
  l2BitcoinRedeemerAddress: true,
});

export const SeiChainConfigSchema = CommonConfigForSei.extend({
  chainName: z.string().default('Sei'),
  chainType: z.literal(CHAIN_TYPE.SEI).default(CHAIN_TYPE.SEI),
  // Sei-specific fields
  l1BitcoinDepositorStartBlock: z.coerce.number().int().nonnegative().default(0),
  // L1 private key for chains using endpoint mode
  // This is the Ethereum private key used to pay for L1 transactions
  privateKey: z
    .string()
    .min(1, 'privateKey is required for endpoint mode to pay L1 transactions')
    .optional(),
  
  // Sei L2 token address (on Sei EVM network)
  // This is the L2 TBTC token address on Sei EVM (native Chain ID: 1329 for mainnet)
  l2TokenAddress: EthereumAddressSchema,
  
  // Wormhole Chain ID: 40 (used for cross-chain messaging via Wormhole NTT)
  // NOTE: This is NOT the same as Sei EVM's native Chain ID (1329 for Pacific-1 mainnet)
  // Wormhole uses its own chain ID namespace for cross-chain message routing
  wormholeChainId: z.coerce.number().int().nonnegative().default(40),
  
  // Overriding these as optional to maintain compatibility with AnyChainConfig
  l2Rpc: z.string().url('l2Rpc must be a valid URL').optional(),
}).refine((data) => data.chainType === CHAIN_TYPE.SEI, {
  message: 'Chain type must be Sei for SeiChainConfigSchema.',
  path: ['chainType'],
});

export type SeiChainConfig = z.infer<typeof SeiChainConfigSchema>;

