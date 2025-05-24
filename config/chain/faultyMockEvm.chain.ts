import { NETWORK, CHAIN_TYPE } from '../schemas/common.schema.js';
import { getEnv } from '../../utils/Env.js';
import type { EvmChainConfig } from '../schemas/evm.chain.schema.js';
import type { EthereumAddress } from '../schemas/shared.js';

export const faultyMockEvmConfig: EvmChainConfig = {
  chainType: CHAIN_TYPE.EVM,
  chainName: getEnv('FAULTY_MOCK_EVM_NAME', 'FaultyMockEVM'),
  network: NETWORK.TESTNET,
  useEndpoint: false,
  enableL2Redemption: true,
  privateKey: getEnv(
    'FAULTY_MOCK_EVM_PRIVATE_KEY',
    '0x0000000000000000000000000000000000000000000000000000000000000003', // Different PK
  ),
  l1Rpc: getEnv('FAULTY_MOCK_EVM_L1_RPC', 'http://localhost:8545'),
  l2Rpc: getEnv('FAULTY_MOCK_EVM_L2_RPC_URL', 'http://localhost:8550'), // Different L2 RPC
  l2WsRpc: getEnv('FAULTY_MOCK_EVM_L2_WS_RPC_URL', 'ws://localhost:8551'), // Different WS RPC
  l1ContractAddress: getEnv(
    'FAULTY_MOCK_EVM_L1_CONTRACT_ADDRESS',
    '0x1111111111111111111111111111111111111111',
  ) as EthereumAddress,
  l2ContractAddress: getEnv(
    'FAULTY_MOCK_EVM_L2_CONTRACT_ADDRESS',
    '0xdddddddddddddddddddddddddddddddddddddddd', // Different L2 contract
  ) as EthereumAddress,
  l1BitcoinRedeemerAddress: getEnv(
    'FAULTY_MOCK_EVM_L1_BTC_REDEEMER',
    '0x3333333333333333333333333333333333333333',
  ) as EthereumAddress,
  l2BitcoinRedeemerAddress: getEnv(
    'FAULTY_MOCK_EVM_L2_BTC_REDEEMER',
    '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', // Different L2 redeemer
  ) as EthereumAddress,
  l2WormholeGatewayAddress: getEnv(
    'FAULTY_MOCK_EVM_L2_WORMHOLE_GATEWAY',
    '0xffffffffffffffffffffffffffffffffffffffff', // Different gateway
  ) as EthereumAddress,
  l2WormholeChainId: parseInt(getEnv('FAULTY_MOCK_EVM_L2_WORMHOLE_CHAIN_ID', '4')), // Different chain ID
  l2StartBlock: parseInt(getEnv('FAULTY_MOCK_EVM_L2_START_BLOCK', '0')),
  vaultAddress: getEnv(
    'FAULTY_MOCK_EVM_VAULT_ADDRESS',
    '0x6666666666666666666666666666666666666666',
  ) as EthereumAddress,
};
