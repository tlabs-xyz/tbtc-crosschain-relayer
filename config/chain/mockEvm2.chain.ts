import { NETWORK, CHAIN_TYPE } from '../schemas/common.schema.js';
import { getEnv } from '../../utils/Env.js';
import type { EvmChainConfig } from '../schemas/evm.chain.schema.js';
import type { EthereumAddress } from '../schemas/shared.js';

export const mockEvm2Config: EvmChainConfig = {
  chainType: CHAIN_TYPE.EVM,
  chainName: getEnv('MOCK_EVM2_NAME', 'MockEVM2'),
  network: NETWORK.TESTNET,
  useEndpoint: false,
  enableL2Redemption: true,
  privateKey: getEnv(
    'MOCK_EVM2_PRIVATE_KEY',
    '0x0000000000000000000000000000000000000000000000000000000000000002',
  ),
  l1Rpc: getEnv('MOCK_EVM2_L1_RPC', 'http://localhost:8545'),
  l2Rpc: getEnv('MOCK_EVM2_L2_RPC_URL', 'http://localhost:8548'),
  l2WsRpc: getEnv('MOCK_EVM2_L2_WS_RPC_URL', 'ws://localhost:8549'),
  l1ContractAddress: getEnv(
    'MOCK_EVM2_L1_CONTRACT_ADDRESS',
    '0x1111111111111111111111111111111111111111',
  ) as EthereumAddress,
  l2ContractAddress: getEnv(
    'MOCK_EVM2_L2_CONTRACT_ADDRESS',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  ) as EthereumAddress,
  l1BitcoinRedeemerAddress: getEnv(
    'MOCK_EVM2_L1_BTC_REDEEMER',
    '0x3333333333333333333333333333333333333333',
  ) as EthereumAddress,
  l2BitcoinRedeemerAddress: getEnv(
    'MOCK_EVM2_L2_BTC_REDEEMER',
    '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  ) as EthereumAddress,
  l2WormholeGatewayAddress: getEnv(
    'MOCK_EVM2_L2_WORMHOLE_GATEWAY',
    '0xcccccccccccccccccccccccccccccccccccccccc',
  ) as EthereumAddress,
  l2WormholeChainId: parseInt(getEnv('MOCK_EVM2_L2_WORMHOLE_CHAIN_ID', '3')),
  l2StartBlock: parseInt(getEnv('MOCK_EVM2_L2_START_BLOCK', '0')),
  vaultAddress: getEnv(
    'MOCK_EVM2_VAULT_ADDRESS',
    '0x6666666666666666666666666666666666666666',
  ) as EthereumAddress,
};
