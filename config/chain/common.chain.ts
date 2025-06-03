import type { CommonChainConfigSchema } from '../schemas/common.schema.js';
import { type z } from 'zod';

type CommonChainInput = z.input<typeof CommonChainConfigSchema>;

export const commonChainInput: CommonChainInput = {
  l1Rpc: 'https://rpc.sepolia.org',
  l2Rpc: 'https://sepolia.arbitrum.io/rpc',
  l1ContractAddress: '0x1111111111111111111111111111111111111111',
  l1BitcoinRedeemerAddress: '0x2222222222222222222222222222222222222222',
  l2BitcoinRedeemerAddress: '0x3333333333333333333333333333333333333333',
  l2WormholeGatewayAddress: '0x4444444444444444444444444444444444444444',
  l2ContractAddress: '0x5555555555555555555555555555555555555555',
  l2WormholeChainId: 10001,
  l2WsRpc: 'wss://sepolia.arbitrum.io/feed',
  vaultAddress: '0x6666666666666666666666666666666666666666',
  l2StartBlock: 100000,
};
