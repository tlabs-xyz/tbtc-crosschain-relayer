import { NETWORK, CHAIN_TYPE } from '../schemas/common.schema';
import type { EvmChainConfig } from '../schemas/evm.chain.schema';
import type { EthereumAddress } from '../schemas/shared';

export const mockEvm2Config: EvmChainConfig = {
  chainType: CHAIN_TYPE.EVM,
  chainName: 'MockEVM2',
  network: NETWORK.TESTNET,
  useEndpoint: false,
  enableL2Redemption: true,
  supportsRevealDepositAPI: true,
  privateKey: '0x0000000000000000000000000000000000000000000000000000000000000002',
  l1Rpc: 'http://localhost:8545',
  l2Rpc: 'http://localhost:8548',
  l2WsRpc: 'ws://localhost:8549',
  l1ContractAddress: '0x1111111111111111111111111111111111111111' as EthereumAddress,
  l2ContractAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as EthereumAddress,
  l1BitcoinRedeemerAddress: '0x3333333333333333333333333333333333333333' as EthereumAddress,
  l2BitcoinRedeemerAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as EthereumAddress,
  l2WormholeGatewayAddress: '0xcccccccccccccccccccccccccccccccccccccccc' as EthereumAddress,
  l2WormholeChainId: parseInt('3'),
  l2StartBlock: parseInt('0'),
  vaultAddress: '0x6666666666666666666666666666666666666666' as EthereumAddress,
};
