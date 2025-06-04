import { z } from 'zod';
import { NETWORK, CHAIN_TYPE } from '../schemas/common.schema.js';
import type { SolanaChainConfigSchema } from '../schemas/solana.chain.schema.js';
import { getEnv, getEnvNumber } from '../../utils/Env.js';
import {
  WORMHOLE_CHAIN_IDS,
  L1_CONTRACT_ADDRESSES,
  VAULT_ADDRESSES,
  L1_CONFIRMATIONS,
  FEATURE_FLAGS,
  PUBLIC_RPCS, // For ETH_SEPOLIA_RPC
  PUBLIC_WS_RPCS,
} from './common.chain.js';
import { solanaCommonInput } from './solana-common.js'; // Import new Solana common input

type SolanaChainInput = z.input<typeof SolanaChainConfigSchema>;

// A more complete generic Solana Devnet configuration
export const solanaDevnetChainInput: SolanaChainInput = {
  ...solanaCommonInput, // Spread Solana common defaults
  chainType: CHAIN_TYPE.SOLANA, // Explicitly set chainType to satisfy TypeScript

  // == Chain Identity & Network Type (Overrides specific to this instance) ==
  chainName: 'SolanaDevnet',
  network: NETWORK.DEVNET, // Explicitly Devnet

  // == RPC Configuration (Overrides) ==
  l1Rpc: getEnv('ETHEREUM_SEPOLIA_RPC', PUBLIC_RPCS['ethereum-sepolia']), // Devnet usually on Sepolia L1
  l2Rpc: getEnv('CHAIN_SOLANADEVNET_L2_RPC', PUBLIC_RPCS['solana-devnet']),
  l2WsRpc: getEnv('CHAIN_SOLANADEVNET_L2_WS_RPC', PUBLIC_WS_RPCS['solana-devnet']),

  // == Block Configuration (Overrides) ==
  l2StartBlock: getEnvNumber('CHAIN_SOLANADEVNET_L2_START_BLOCK', 0),
  l1Confirmations: L1_CONFIRMATIONS.TESTNET, // Devnet uses testnet confirmations

  // == Contract Addresses (Overrides using Testnet values for Devnet) ==
  l1ContractAddress: L1_CONTRACT_ADDRESSES[NETWORK.TESTNET], // Reverted: Devnet uses Testnet L1 contracts
  vaultAddress: VAULT_ADDRESSES[NETWORK.TESTNET], // Reverted: Devnet uses Testnet Vault
  l2ContractAddress: getEnv('CHAIN_SOLANADEVNET_L2_CONTRACT_ADDRESS', '11111111111111111111111111111111'), // Use ENV var, fallback to placeholder

  // == Wormhole Configuration (Placeholders - Adjust for actual Solana Devnet Wormhole) ==
  l2WormholeGatewayAddress: 'MockSolanaWgway11111111111111111111111111',
  l2WormholeChainId: WORMHOLE_CHAIN_IDS.SOLANA,

  // == Solana-Specific Configuration ==
  solanaPrivateKey: getEnv('CHAIN_SOLANADEVNET_SOLANA_PRIVATE_KEY'),
  solanaSignerKeyBase: getEnv('CHAIN_SOLANADEVNET_SOLANA_KEY_BASE'),

  // == Feature Flags (Overrides) ==
  enableL2Redemption: FEATURE_FLAGS.ENABLE_L2_REDEMPTION_TESTNET, // Enable for testing on devnet
};
