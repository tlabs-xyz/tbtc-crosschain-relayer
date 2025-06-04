import { z } from 'zod';
import { NETWORK } from '../schemas/common.schema.js';
import type { SuiChainConfigSchema } from '../schemas/sui.chain.schema.js';
import { getEnv, getEnvNumber } from '../../utils/Env.js';
import { getSuiCommonInput } from './sui-common.js';

// Use the correct type for input validation
import type { SuiChainConfig } from '../schemas/sui.chain.schema.js';

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
    // 'suiPrivateKey', // This field is populated later from env; getEnv handles missing variable.
    // 'l2ContractAddress', // This field is populated later from env or default; getEnv handles this.
    // 'l2WormholeGatewayAddress', // This field is populated later from env or default; getEnv handles this.
  ];
  for (const field of requiredFields) {
    if (
      typeof field === 'string' &&
      (commonTestnetSuiInput[field] === undefined || commonTestnetSuiInput[field] === null)
    ) {
      throw new Error(
        `getSuiTestnetChainInput: Missing required field '${String(field)}' in commonTestnetSuiInput.`,
      );
    }
  }

  const config: SuiChainInput = {
    network: commonTestnetSuiInput.network as import('../schemas/common.schema.js').NETWORK,
    chainType:
      commonTestnetSuiInput.chainType as import('../schemas/common.schema.js').CHAIN_TYPE.SUI,
    l1Rpc: commonTestnetSuiInput.l1Rpc as string,
    vaultAddress: commonTestnetSuiInput.vaultAddress as string,
    l1ContractAddress: commonTestnetSuiInput.l1ContractAddress as string,
    l1Confirmations: commonTestnetSuiInput.l1Confirmations as number,
    enableL2Redemption: commonTestnetSuiInput.enableL2Redemption as boolean,
    useEndpoint: commonTestnetSuiInput.useEndpoint as boolean,
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
