import type { EvmChainConfig } from '../../config/schemas/evm.chain.schema.js';
import type { SolanaChainConfig } from '../../config/schemas/solana.chain.schema.js';
import { NETWORK, CHAIN_TYPE } from '../../config/schemas/common.schema';

// Mock EVM Configuration 1
export const mockEVM1Config: EvmChainConfig = {
  chainName: 'MockEVM1',
  chainType: CHAIN_TYPE.EVM,
  network: NETWORK.TESTNET,
  useEndpoint: false,
  supportsRevealDepositAPI: false,
  enableL2Redemption: true,
  l1Rpc: 'http://localhost:8545',
  l2Rpc: 'http://localhost:9545',
  l2WsRpc: 'ws://localhost:9546',
  l1ContractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  l2ContractAddress: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  l1BitcoinRedeemerAddress: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
  l2BitcoinRedeemerAddress: '0x9A676e781A523b5d0C0e43731313A708CB607508',
  l2WormholeGatewayAddress: '0x0123456789abcdef0123456789abcdef01234567',
  l2WormholeChainId: 2,
  l2StartBlock: 0,
  vaultAddress: '0xBE59CF93d83196902f9791747027E1086A7995f5',
  l1Confirmations: 1,
};

// Mock EVM Configuration 2
export const mockEVM2Config: EvmChainConfig = {
  chainName: 'MockEVM2',
  chainType: CHAIN_TYPE.EVM,
  network: NETWORK.TESTNET,
  useEndpoint: true,
  supportsRevealDepositAPI: true,
  endpointUrl: 'http://localhost:3000/api/mockevm2',
  enableL2Redemption: false,
  l1Rpc: 'http://localhost:8547',
  l2Rpc: 'http://localhost:9547',
  l2WsRpc: 'ws://localhost:9548',
  l1ContractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  l2ContractAddress: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  l1BitcoinRedeemerAddress: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
  l2BitcoinRedeemerAddress: '0x9A676e781A523b5d0C0e43731313A708CB607508',
  l2WormholeGatewayAddress: '0x0123456789abcdef0123456789abcdef01234567',
  l2WormholeChainId: 3,
  l2StartBlock: 0,
  vaultAddress: '0xBE59CF93d83196902f9791747027E1086A7995f5',
  l1Confirmations: 1,
};

// Mock Faulty EVM Configuration (can be made faulty if needed by specific tests)
export const faultyMockEVMConfig: EvmChainConfig = {
  chainName: 'FaultyMockEVM',
  chainType: CHAIN_TYPE.EVM,
  network: NETWORK.TESTNET,
  useEndpoint: false,
  supportsRevealDepositAPI: false,
  enableL2Redemption: true,
  l1Rpc: 'http://localhost:invalid8545',
  l2Rpc: 'http://localhost:invalid9545',
  l2WsRpc: 'ws://localhost:invalid9546',
  l1ContractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  l2ContractAddress: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  l1BitcoinRedeemerAddress: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
  l2BitcoinRedeemerAddress: '0x9A676e781A523b5d0C0e43731313A708CB607508',
  l2WormholeGatewayAddress: '0x0123456789abcdef0123456789abcdef01234567',
  l2WormholeChainId: 4,
  l2StartBlock: 0,
  vaultAddress: '0xBE59CF93d83196902f9791747027E1086A7995f5',
  l1Confirmations: 1,
};

// Mock Solana Configuration
export const mockSolanaConfig: SolanaChainConfig = {
  chainName: 'MockSolana',
  chainType: CHAIN_TYPE.SOLANA,
  network: NETWORK.DEVNET,
  useEndpoint: false,
  supportsRevealDepositAPI: false,
  enableL2Redemption: false,
  l1Rpc: 'http://localhost:8545',
  l2Rpc: 'http://localhost:8899',
  l2WsRpc: 'ws://localhost:8900',
  l1ContractAddress: '',
  l2ContractAddress: 'MockL2SolanaProgramId',
  l1BitcoinRedeemerAddress: '0x000000000000000000000000000000000000dEaD',
  l2WormholeGatewayAddress: 'worm22222222222222222222222222222222222222',
  l2WormholeChainId: 1,
  l2StartBlock: 0,
  vaultAddress: 'MockSolanaVaultAddress',
  l1Confirmations: 1,
  solanaPrivateKey: 'MOCK_SOLANA_PRIVATE_KEY_DO_NOT_USE_IN_PROD',
  solanaCommitment: 'confirmed',
  solanaSignerKeyBase: 'ReplaceWithMockBase58PrivateKeyForSolanaSigner',
};

// Array of all mock configs for easy import in jest.global-setup.js
export const allMockChainConfigs = [
  mockEVM1Config,
  mockEVM2Config,
  faultyMockEVMConfig,
  mockSolanaConfig,
];
