import { type Network, toChainId, type ChainId } from '@wormhole-foundation/sdk';

// --- Constants for Scenarios ---
export const L1_CHAIN_ID_ETH = toChainId('Ethereum');
export const L2_CHAIN_ID_SUI = toChainId('Sui');
export const TARGET_CHAIN_ID_ARB = toChainId('Arbitrum');

export const TEST_NETWORK: Network = 'Testnet';

export const L2_CHAIN_ID_AVAX = toChainId('Avalanche');
// TARGET_CHAIN_ID_ETH is the same as L1_CHAIN_ID_ETH, defined above.

export interface TestScenario {
  description: string;
  l2ChainName: 'Sui' | 'Avalanche' | string; // Allow string for future extensibility
  l2ChainId: ChainId;
  l2RpcUrl: string;
  targetL1ChainName: 'Arbitrum' | 'Ethereum' | string; // Allow string
  targetL1ChainId: ChainId;
  expectedEmitterAddress: string;
}

export const testScenarios: TestScenario[] = [
  {
    description: 'Sui (L2) -> Ethereum (L1)',
    l2ChainName: 'Sui',
    l2ChainId: L2_CHAIN_ID_SUI,
    l2RpcUrl: 'http://sui-mock-l2-rpc.com',
    targetL1ChainName: 'Ethereum',
    targetL1ChainId: L1_CHAIN_ID_ETH,
    expectedEmitterAddress: '0x' + '1'.repeat(40),
  },
  {
    description: 'Avalanche (L2) -> Ethereum (L1)',
    l2ChainName: 'Avalanche',
    l2ChainId: L2_CHAIN_ID_AVAX,
    l2RpcUrl: 'http://avax-mock-l2-rpc.com',
    targetL1ChainName: 'Ethereum',
    targetL1ChainId: L1_CHAIN_ID_ETH,
    expectedEmitterAddress: '0x' + '1'.repeat(40),
  },
  {
    description: 'Sui (L2) -> Ethereum (L1)',
    l2ChainName: 'Sui',
    l2ChainId: L2_CHAIN_ID_SUI,
    l2RpcUrl: 'http://sui-mock-l2-rpc.com',
    targetL1ChainName: 'Ethereum',
    targetL1ChainId: L1_CHAIN_ID_ETH,
    expectedEmitterAddress: '0x' + '1'.repeat(40),
  },
  {
    description: 'Avalanche (L2) -> Ethereum (L1)',
    l2ChainName: 'Avalanche',
    l2ChainId: L2_CHAIN_ID_AVAX,
    l2RpcUrl: 'http://avax-mock-l2-rpc.com',
    targetL1ChainName: 'Ethereum',
    targetL1ChainId: L1_CHAIN_ID_ETH,
    expectedEmitterAddress: '0x' + '1'.repeat(40),
  },
];
