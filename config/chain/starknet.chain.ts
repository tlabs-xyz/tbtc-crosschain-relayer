/**
 * Starknet chain configuration for testnet deployments.
 *
 * This file defines the configuration object for the Starknet testnet chain,
 * including all required environment variables, sensible defaults for testnet,
 * and type safety for integration with the rest of the system.
 *
 * Fields are loaded from environment variables, with fallbacks for testnet safety.
 * Update this file to add or modify chain-specific configuration for Starknet.
 */
import { type z } from 'zod';
import { CHAIN_TYPE, NETWORK } from '../schemas/common.schema.js';
import type { StarknetChainConfigSchema } from '../schemas/starknet.chain.schema.js';
import { commonChainInput } from './common.chain.js';
import { getEnv, getEnvOptional } from '../../utils/Env.js';

type StarknetChainInput = z.input<typeof StarknetChainConfigSchema>;

export const starknetTestnetChainInput: StarknetChainInput = {
  ...commonChainInput,

  // Chain identity
  chainName: 'StarknetTestnet',
  chainType: CHAIN_TYPE.STARKNET,
  network: NETWORK.TESTNET,

  // Required by StarknetChainBaseSchema - use safe placeholders if env vars are missing
  starknetPrivateKey:
    getEnvOptional('CHAIN_STARKNETTESTNET_PRIVATE_KEY') ||
    '0x0000000000000000000000000000000000000000000000000000000000000001', // Testnet fallback
  starknetDeployerAddress:
    getEnvOptional('CHAIN_STARKNETTESTNET_DEPLOYER_ADDRESS') ||
    '0x0000000000000000000000000000000000000000000000000000000000000001', // Testnet fallback
  l1Rpc: getEnv('CHAIN_SEPOLIATESTNET_L1_RPC'), // Required: L1 RPC endpoint
  l2Rpc: getEnv('STARKNET_TESTNET_L2_RPC'), // Required: L2 RPC endpoint
  l2WsRpc: getEnvOptional('STARKNET_TESTNET_L2_WS_RPC') || '', // Optional: L2 WebSocket endpoint
  l1ContractAddress: getEnv('STARKNET_TESTNET_L1_CONTRACT_ADDRESS'), // Required: L1 contract address
  starkGateBridgeAddress: '0x0000000000000000000000000000000000000000', // Placeholder for StarkGate bridge
  l1BitcoinRedeemerAddress: getEnv('CHAIN_SEPOLIATESTNET_L1_REDEEMER_ADDRESS'), // Required: L1 redeemer address
  l2WormholeGatewayAddress: getEnvOptional('STARKNET_TESTNET_L2_WORMHOLE_GATEWAY_ADDRESS') || '', // Optional: L2 Wormhole gateway
  l2WormholeChainId: Number(getEnvOptional('STARKNET_TESTNET_L2_WORMHOLE_CHAIN_ID') || '0'), // Optional: Wormhole chain ID
} as const;
