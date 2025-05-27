import { type Network, toChainId, type ChainId } from '@wormhole-foundation/sdk';

// --- Constants for Scenarios ---
export const L1_CHAIN_ID_ETH = toChainId('Ethereum');
export const L2_CHAIN_ID_SUI = toChainId('Sui');
export const TARGET_CHAIN_ID_ARB = toChainId('Arbitrum');
export const L1_WORMHOLE_TOKEN_BRIDGE_EMITTER_ADDRESS = '0x' + '1'.repeat(40);

export const MOCK_SUI_RPC_URL = 'http://sui-mock-l2-rpc.com';
export const TEST_NETWORK: Network = 'Testnet';

export const L2_CHAIN_ID_AVAX = toChainId('Avalanche');
export const MOCK_AVAX_RPC_URL = 'http://avax-mock-l2-rpc.com';
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
    description: 'Sui (L2) -> Arbitrum (L1)',
    l2ChainName: 'Sui',
    l2ChainId: L2_CHAIN_ID_SUI,
    l2RpcUrl: MOCK_SUI_RPC_URL,
    targetL1ChainName: 'Arbitrum',
    targetL1ChainId: TARGET_CHAIN_ID_ARB,
    expectedEmitterAddress: L1_WORMHOLE_TOKEN_BRIDGE_EMITTER_ADDRESS,
  },
  {
    description: 'Avalanche (L2) -> Arbitrum (L1)',
    l2ChainName: 'Avalanche',
    l2ChainId: L2_CHAIN_ID_AVAX,
    l2RpcUrl: MOCK_AVAX_RPC_URL,
    targetL1ChainName: 'Arbitrum',
    targetL1ChainId: TARGET_CHAIN_ID_ARB,
    expectedEmitterAddress: L1_WORMHOLE_TOKEN_BRIDGE_EMITTER_ADDRESS,
  },
  {
    description: 'Sui (L2) -> Ethereum (L1)',
    l2ChainName: 'Sui',
    l2ChainId: L2_CHAIN_ID_SUI,
    l2RpcUrl: MOCK_SUI_RPC_URL,
    targetL1ChainName: 'Ethereum',
    targetL1ChainId: L1_CHAIN_ID_ETH,
    expectedEmitterAddress: L1_WORMHOLE_TOKEN_BRIDGE_EMITTER_ADDRESS,
  },
  {
    description: 'Avalanche (L2) -> Ethereum (L1)',
    l2ChainName: 'Avalanche',
    l2ChainId: L2_CHAIN_ID_AVAX,
    l2RpcUrl: MOCK_AVAX_RPC_URL,
    targetL1ChainName: 'Ethereum',
    targetL1ChainId: L1_CHAIN_ID_ETH,
    expectedEmitterAddress: L1_WORMHOLE_TOKEN_BRIDGE_EMITTER_ADDRESS,
  },
];
