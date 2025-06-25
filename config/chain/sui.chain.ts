import { z } from 'zod';
import { NETWORK } from '../schemas/common.schema.js';
import type { SuiChainConfigSchema } from '../schemas/sui.chain.schema.js';
import { getEnv, getEnvNumber } from '../../utils/Env.js';
import { getSuiCommonInput } from './sui-common.js';

type SuiChainInput = z.input<typeof SuiChainConfigSchema>;

// Generic Sui Testnet Configuration
export const getSuiTestnetChainInput = (): SuiChainInput => {
  const commonTestnetSuiInput = getSuiCommonInput(NETWORK.TESTNET);

  // Validate required properties from commonTestnetSuiInput
  const requiredFields: Array<keyof Partial<SuiChainInput>> = [
    'network',
    'chainType',
    'l1Rpc',
    'vaultAddress',
    'l1ContractAddress',
    'l1Confirmations',
    'enableL2Redemption',
    'useEndpoint',
  ];
  for (const field of requiredFields) {
    if (commonTestnetSuiInput[field] === undefined || commonTestnetSuiInput[field] === null) {
      throw new Error(
        `getSuiTestnetChainInput: Missing required field '${String(field)}' in commonTestnetSuiInput.`,
      );
    }
  }

  const config: SuiChainInput = {
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
    l2Rpc: getEnv('CHAIN_SUITESTNET_L2_RPC', 'https://fullnode.testnet.sui.io'),
    l2WsRpc: getEnv('CHAIN_SUITESTNET_L2_WS_RPC', 'wss://fullnode.testnet.sui.io'),
    l2StartBlock: getEnvNumber('CHAIN_SUITESTNET_L2_START_BLOCK', 0),
    l2ContractAddress: getEnv(
      'CHAIN_SUITESTNET_L2_CONTRACT_ADDRESS',
      '0x1db1fcdaada7c286d77f3347e593e06d8f33b8255e0861033a0a9f321f4eade7::bitcoin_depositor',
    ),
    l2WormholeGatewayAddress: getEnv(
      'CHAIN_SUITESTNET_WORMHOLE_GATEWAY',
      '0xc57508ee0d4595e5a8728974a4a93a787d38f339757230d441e895422c07aba9',
    ),
    l2WormholeChainId: getEnvNumber('CHAIN_SUITESTNET_WORMHOLE_CHAIN_ID', 21),
    suiPrivateKey: getEnv('CHAIN_SUITESTNET_SUI_PRIVATE_KEY'),
  };
  return config;
};
