import { NETWORK, CHAIN_TYPE } from '../schemas/common.schema';
import type { EvmChainConfig } from '../schemas/evm.chain.schema';
import type { EthereumAddress } from '../schemas/shared';

export const mockEvm1Config: EvmChainConfig = {
  chainType: CHAIN_TYPE.EVM,
  chainName: 'MockEVM1',
  network: NETWORK.TESTNET,
  useEndpoint: false,
  enableL2Redemption: true,
  supportsRevealDepositAPI: true,
  privateKey: '0x0000000000000000000000000000000000000000000000000000000000000001',
  l1Rpc: 'http://localhost:8545',
  l2Rpc: 'http://localhost:8546',
  l2WsRpc: 'ws://localhost:8547',
  l1ContractAddress: '0x1111111111111111111111111111111111111111' as EthereumAddress,
  l2ContractAddress: '0x2222222222222222222222222222222222222222' as EthereumAddress,
  l1BitcoinRedeemerAddress: '0x3333333333333333333333333333333333333333' as EthereumAddress,
  l2BitcoinRedeemerAddress: '0x4444444444444444444444444444444444444444' as EthereumAddress,
  l2WormholeGatewayAddress: '0x5555555555555555555555555555555555555555' as EthereumAddress,
  l2WormholeChainId: parseInt('2'),
  l2StartBlock: parseInt('0'),
  vaultAddress: '0x6666666666666666666666666666666666666666' as EthereumAddress,
  l1Confirmations: 1,
};
