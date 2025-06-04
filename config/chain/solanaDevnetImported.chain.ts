import { z } from 'zod';
import { NETWORK } from '../schemas/common.schema.js';
import type { SolanaChainConfigSchema } from '../schemas/solana.chain.schema.js';
import { getEnv, getEnvNumber } from '../../utils/Env.js';
import {
  PUBLIC_RPCS, // Used for default l1Rpc
  L1_CONFIRMATIONS, // For L1_CONFIRMATIONS.TESTNET
} from './common.chain.js';
import { solanaCommonInput } from './solana-common.js'; // Import new Solana common input
import { CHAIN_TYPE } from '../schemas/common.schema.js';

type SolanaChainInput = z.input<typeof SolanaChainConfigSchema>;

export const solanaDevnetImportedChainInput: SolanaChainInput = {
  ...solanaCommonInput, // Spread Solana common defaults
  chainType: CHAIN_TYPE.SOLANA, // Explicitly set chainType to satisfy TypeScript

  // == Chain Identity & Network Type (Overrides) ==
  chainName: 'SolanaDevnetImported',
  network: NETWORK.DEVNET, // Explicitly Devnet for this config

  // == RPC Configuration (Specific to this Devnet instance) ==
  l1Rpc: getEnv('ETHEREUM_SEPOLIA_RPC', PUBLIC_RPCS['ethereum-sepolia']),
  l2Rpc: getEnv('CHAIN_SOLANADEVNETIMPORTED_L2_RPC'),
  l2WsRpc: getEnv('CHAIN_SOLANADEVNETIMPORTED_L2_WS_RPC'),

  // == Block Configuration (Specific Overrides) ==
  l2StartBlock: getEnvNumber('CHAIN_SOLANADEVNETIMPORTED_L2_START_BLOCK'),
  l1Confirmations: L1_CONFIRMATIONS.TESTNET,

  // == Contract Addresses (Specific to this Devnet instance - VERIFIED values) ==
  l1ContractAddress: '0x7F025cda2e4ae9CEB1cC31c704b83E72A0889e92',
  vaultAddress: '0xB5679dE944A79732A75CE556191DF11F489448d5',
  l2ContractAddress: getEnv('CHAIN_SOLANADEVNETIMPORTED_L2_CONTRACT'),

  // == Wormhole Configuration (Placeholders/Specific) ==
  l2WormholeGatewayAddress: getEnv('CHAIN_SOLANADEVNETIMPORTED_L2_WORMHOLE_GATEWAY'),
  l2WormholeChainId: getEnvNumber('CHAIN_SOLANADEVNETIMPORTED_L2_WORMHOLE_CHAIN_ID', 1),

  // == Solana-Specific Configuration ==
  solanaPrivateKey: getEnv('CHAIN_SOLANADEVNETIMPORTED_SOLANA_PRIVATE_KEY'),
  solanaSignerKeyBase: getEnv('CHAIN_SOLANADEVNETIMPORTED_SOLANA_KEY_BASE'),

  // == Feature Flags (Specific Overrides) ==
  enableL2Redemption: false,
};
