import type { CommonChainConfigSchema } from '../schemas/chain.common.schema';
import { z } from 'zod';
import { getEnv } from '../../utils/Env.js';

type CommonChainInput = z.input<typeof CommonChainConfigSchema>;

export const commonChainInput: CommonChainInput = {
  l1Rpc: 'https://rpc.sepolia.org',
  l2Rpc: 'https://sepolia.arbitrum.io/rpc',
  l1ContractAddress: '0xPlaceholderSepoliaL1ContractAddress',
  l1BitcoinRedeemerAddress: '0xPlaceholderSepoliaL1BitcoinRedeemer',
  l2BitcoinRedeemerAddress: '0xPlaceholderArbSepoliaL2BitcoinRedeemer',
  l2WormholeGatewayAddress: '0xPlaceholderArbSepoliaWormholeGateway',
  privateKey: getEnv('CHAIN_SEPOLIATESTNET_PRIVATE_KEY'),
  l2ContractAddress: '0xPlaceholderArbSepoliaL2ContractAddress',
  l2WormholeChainId: 10001,
  l2WsRpc: 'wss://sepolia.arbitrum.io/feed',
  vaultAddress: '0xPlaceholderArbSepoliaTbtcVault',
  l2StartBlock: 100000,
};
