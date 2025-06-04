import { z } from 'zod';
import { NETWORK, CHAIN_TYPE } from '../schemas/common.schema.js';
import type { SolanaChainConfigSchema } from '../schemas/solana.chain.schema.js';
import { getEnv, getEnvNumber } from '../../utils/Env.js';

type SolanaChainInput = z.input<typeof SolanaChainConfigSchema>;

export const solanaDevnetImportedChainInput: SolanaChainInput = {
  chainName: 'SolanaDevnetImported',
  chainType: CHAIN_TYPE.SOLANA,
  network: NETWORK.DEVNET,

  // RPC Configuration from legacy: L1_RPC (Ethereum Sepolia), L2_RPC (Solana Devnet)
  l1Rpc: getEnv('ETHEREUM_SEPOLIA_RPC'),
  l2Rpc: getEnv('CHAIN_SOLANADEVNETIMPORTED_L2_RPC'),
  l2WsRpc: getEnv('CHAIN_SOLANADEVNETIMPORTED_L2_WS_RPC'),

  // Block Configuration
  l2StartBlock: getEnvNumber('CHAIN_SOLANADEVNETIMPORTED_L2_START_BLOCK', 0),
  l1Confirmations: 6,

  // Contract Addresses - VERIFIED from imported-configs/solana-devnet-tbtc-relayer.env
  l1ContractAddress: '0x7F025cda2e4ae9CEB1cC31c704b83E72A0889e92', // L1_BITCOIN_DEPOSITOR ✅ VERIFIED
  vaultAddress: '0xB5679dE944A79732A75CE556191DF11F489448d5', // TBTC_VAULT ✅ VERIFIED

  // Bitcoin Redeemer Addresses - REMOVED (contracts don't exist in tBTC v2)
  // Based on research of official Threshold docs and tBTC v2 GitHub repo
  // These features may be added in future versions
  // l1BitcoinRedeemerAddress: getEnv('CHAIN_SOLANADEVNETIMPORTED_L1_BITCOIN_REDEEMER', ''), // ❌ NOT IMPLEMENTED

  // Wormhole Configuration - Placeholder addresses (may not be applicable for Solana)
  l2WormholeGatewayAddress: getEnv(
    'CHAIN_SOLANADEVNETIMPORTED_L2_WORMHOLE_GATEWAY',
    '0x0000000000000000000000000000000000000000',
  ), // Placeholder for validation
  l2WormholeChainId: getEnvNumber('CHAIN_SOLANADEVNETIMPORTED_L2_WORMHOLE_CHAIN_ID', 1), // Solana Wormhole Chain ID

  // L2 Contract Address - Placeholder (Solana uses program addresses, not contract addresses)
  l2ContractAddress: getEnv(
    'CHAIN_SOLANADEVNETIMPORTED_L2_CONTRACT',
    '0x0000000000000000000000000000000000000000',
  ), // Placeholder for validation

  // Solana-specific configuration
  solanaPrivateKey: getEnv('CHAIN_SOLANADEVNETIMPORTED_SOLANA_PRIVATE_KEY', ''),
  solanaCommitment: 'confirmed',
  solanaSignerKeyBase: getEnv('CHAIN_SOLANADEVNETIMPORTED_SOLANA_KEY_BASE', ''), // From legacy: SOLANA_KEY_BASE

  // Feature Flags from legacy: USE_ENDPOINT = true
  useEndpoint: false,
  enableL2Redemption: false,
};
