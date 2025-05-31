import { NETWORK, CHAIN_TYPE } from '../../config/schemas/common.schema';
import type { EvmChainConfig } from '../../config/schemas/evm.chain.schema';
import type { EthereumAddress } from '../../config/schemas/shared';

export const faultyMockEvmConfig: EvmChainConfig = {
  chainType: CHAIN_TYPE.EVM,
  chainName: 'FaultyMockEVM',
  network: NETWORK.TESTNET,
  useEndpoint: false,
  enableL2Redemption: true,
  supportsRevealDepositAPI: true,
  l1Confirmations: 1,
  privateKey: '0x0000000000000000000000000000000000000000000000000000000000000001',
  l1Rpc: 'http://localhost:8545/faulty',
  l2Rpc: 'http://localhost:8550',
  l2WsRpc: 'ws://localhost:8551',
  l1ContractAddress: '0x1111111111111111111111111111111111111111' as EthereumAddress,
  l2ContractAddress: '0xdddddddddddddddddddddddddddddddddddddddd' as EthereumAddress,
  l1BitcoinRedeemerAddress: '0x3333333333333333333333333333333333333333' as EthereumAddress,
  l2BitcoinRedeemerAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as EthereumAddress,
  l2WormholeGatewayAddress: '0xffffffffffffffffffffffffffffffffffffffff' as EthereumAddress,
  l2WormholeChainId: 2000,
  l2StartBlock: 0,
  vaultAddress: '0x6666666666666666666666666666666666666666' as EthereumAddress,
};
