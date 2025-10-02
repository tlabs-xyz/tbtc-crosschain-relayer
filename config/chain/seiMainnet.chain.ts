import { z } from 'zod';
import { NETWORK, CHAIN_TYPE } from '../schemas/common.schema.js';
import type { EvmChainConfigSchema } from '../schemas/evm.chain.schema.js';
import { getEnv, getEnvNumber } from '../../utils/Env.js';
import {
  WORMHOLE_CHAIN_IDS,
  NTT_MANAGERS,
  NTT_MANAGER_WITH_EXECUTOR,
  PUBLIC_RPCS,
  PUBLIC_WS_RPCS,
  getCommonChainInput,
} from './common.chain.js';

type EvmChainInput = z.input<typeof EvmChainConfigSchema>;

export const getSeiMainnetChainInput = (): EvmChainInput => {
  const commonMainnetInput = getCommonChainInput(NETWORK.MAINNET);

  const config: EvmChainInput = {
    network: commonMainnetInput.network as NETWORK,
    l1Rpc: commonMainnetInput.l1Rpc as string,
    vaultAddress: commonMainnetInput.vaultAddress as string,
    l1ContractAddress: getEnv('CHAIN_SEIMAINNET_L1_CONTRACT_ADDRESS', '0x0000000000000000000000000000000000000000'), // L1BTCDepositorNttWithExecutor placeholder
    l1Confirmations: getEnvNumber(
      'CHAIN_SEIMAINNET_L1_CONFIRMATIONS',
      commonMainnetInput.l1Confirmations as number,
    ),
    enableL2Redemption: commonMainnetInput.enableL2Redemption as boolean,
    useEndpoint: commonMainnetInput.useEndpoint as boolean,
    supportsRevealDepositAPI:
      commonMainnetInput.supportsRevealDepositAPI === undefined
        ? false
        : commonMainnetInput.supportsRevealDepositAPI,
    endpointUrl: commonMainnetInput.endpointUrl,

    // SeiEVM Mainnet-specific values
    chainName: 'SeiMainnet',
    chainType: CHAIN_TYPE.EVM,
    privateKey: getEnv('CHAIN_SEIMAINNET_PRIVATE_KEY'),
    l2Rpc: getEnv('CHAIN_SEIMAINNET_L2_RPC', PUBLIC_RPCS['sei-mainnet']),
    l2WsRpc: getEnv('CHAIN_SEIMAINNET_L2_WS_RPC', PUBLIC_WS_RPCS['sei-mainnet']),
    l2StartBlock: getEnvNumber('CHAIN_SEIMAINNET_L2_START_BLOCK', 0), // Update with actual start block
    l2ContractAddress: getEnv('CHAIN_SEIMAINNET_L2_CONTRACT_ADDRESS', '0xF9201c9192249066Aec049ae7951ae298BBEc767'), // L2TBTC.sol Proxy
    l2WormholeGatewayAddress: getEnv('CHAIN_SEIMAINNET_L2_NTT_MANAGER', NTT_MANAGERS.SEI_EVM), // NttManager: 0xc10a0886d4Fe06bD61f41ee2855a2215375B82f0
    l2WormholeChainId: WORMHOLE_CHAIN_IDS.SEI_EVM, // SeiEVM Wormhole chain ID = 40
    l2NttManagerWithExecutorAddress: getEnv('CHAIN_SEIMAINNET_L2_NTT_MANAGER_WITH_EXECUTOR', NTT_MANAGER_WITH_EXECUTOR.SEI_EVM), // NttManagerWithExecutor: 0x3F2D6441C7a59Dfe80f8e14142F9E28F6D440445
  };
  return config;
};
