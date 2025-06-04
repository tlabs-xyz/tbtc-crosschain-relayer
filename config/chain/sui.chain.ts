import { z } from 'zod';
import { NETWORK } from '../schemas/common.schema.js';
import type { SuiChainConfigSchema } from '../schemas/sui.chain.schema.js';
import { getEnv, getEnvNumber } from '../../utils/Env.js';
import { getSuiCommonInput } from './sui-common.js';

type SuiChainInput = z.input<typeof SuiChainConfigSchema>;

// Generic Sui Testnet Configuration
export const getSuiTestnetChainInput = (): SuiChainInput => {
  const commonTestnetSuiInput = getSuiCommonInput(NETWORK.TESTNET);

  const config: SuiChainInput = {
    // Explicitly assign properties from commonTestnetSuiInput or overrides
    network: commonTestnetSuiInput.network!,
    chainType: commonTestnetSuiInput.chainType!,
    l1Rpc: commonTestnetSuiInput.l1Rpc!,
    vaultAddress: commonTestnetSuiInput.vaultAddress!,
    l1ContractAddress: commonTestnetSuiInput.l1ContractAddress!,
    l1Confirmations: commonTestnetSuiInput.l1Confirmations!,
    enableL2Redemption: commonTestnetSuiInput.enableL2Redemption!,
    useEndpoint: commonTestnetSuiInput.useEndpoint!,
    supportsRevealDepositAPI:
      commonTestnetSuiInput.supportsRevealDepositAPI === undefined
        ? false
        : commonTestnetSuiInput.supportsRevealDepositAPI,
    endpointUrl: commonTestnetSuiInput.endpointUrl,
    suiGasObjectId: getEnv(
      'CHAIN_SUITESTNET_SUI_GAS_OBJECT_ID',
      commonTestnetSuiInput.suiGasObjectId, // Default from getSuiCommonInput (can be empty string)
    ),

    // SuiTestnet-specific values
    chainName: 'SuiTestnet',
    l2Rpc: getEnv('CHAIN_SUITESTNET_L2_RPC'),
    l2WsRpc: getEnv('CHAIN_SUITESTNET_L2_WS_RPC', ''), // Default to empty string if not set
    l2StartBlock: getEnvNumber('CHAIN_SUITESTNET_L2_START_BLOCK', 0),
    l2ContractAddress: getEnv(
      'CHAIN_SUITESTNET_L2_CONTRACT_ADDRESS',
      '0xSuiPackageId::module::Struct', // Default placeholder
    ),
    l2WormholeGatewayAddress: getEnv(
      'CHAIN_SUITESTNET_WORMHOLE_GATEWAY',
      '0x00mockSuiWormholeGateway000000000000000000000000000000000000000', // Mock Sui address format
    ),
    l2WormholeChainId: getEnvNumber('CHAIN_SUITESTNET_WORMHOLE_CHAIN_ID', 21),
    suiPrivateKey: getEnv('CHAIN_SUITESTNET_SUI_PRIVATE_KEY'),
  };
  return config;
};
