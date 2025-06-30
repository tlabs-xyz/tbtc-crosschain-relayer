import { z } from 'zod';
import { NETWORK } from '../schemas/common.schema.js';
import type { SuiChainConfigSchema } from '../schemas/sui.chain.schema.js';
import { getEnv, getEnvNumber } from '../../utils/Env.js';
import { getSuiCommonInput } from './sui-common.js';

type SuiChainInput = z.input<typeof SuiChainConfigSchema>;

// Generic Sui Mainnet Configuration
export const getSuiMainnetChainInput = (): SuiChainInput => {
  const commonMainnetSuiInput = getSuiCommonInput(NETWORK.MAINNET);

  // Validate required properties from commonMainnetSuiInput
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
    if (commonMainnetSuiInput[field] === undefined || commonMainnetSuiInput[field] === null) {
      throw new Error(
        `getSuiMainnetChainInput: Missing required field '${String(field)}' in commonMainnetSuiInput.`,
      );
    }
  }

  const config: SuiChainInput = {
    network: commonMainnetSuiInput.network!,
    chainType: commonMainnetSuiInput.chainType!,
    l1Rpc: commonMainnetSuiInput.l1Rpc!,
    vaultAddress: commonMainnetSuiInput.vaultAddress!,
    l1ContractAddress: commonMainnetSuiInput.l1ContractAddress!,
    l1Confirmations: commonMainnetSuiInput.l1Confirmations!,
    enableL2Redemption: commonMainnetSuiInput.enableL2Redemption!,
    useEndpoint: commonMainnetSuiInput.useEndpoint!,
    supportsRevealDepositAPI:
      commonMainnetSuiInput.supportsRevealDepositAPI === undefined
        ? false
        : commonMainnetSuiInput.supportsRevealDepositAPI,
    endpointUrl: commonMainnetSuiInput.endpointUrl,
    suiGasObjectId: getEnv(
      'CHAIN_SUIMAINNET_SUI_GAS_OBJECT_ID',
      commonMainnetSuiInput.suiGasObjectId, // Default from getSuiCommonInput (can be empty string)
    ),

    // SuiMainnet-specific values
    chainName: 'SuiMainnet',
    l2Rpc: getEnv('CHAIN_SUIMAINNET_L2_RPC', 'https://fullnode.mainnet.sui.io'),
    l2WsRpc: getEnv('CHAIN_SUIMAINNET_L2_WS_RPC', 'wss://fullnode.mainnet.sui.io'),
    l2StartBlock: getEnvNumber('CHAIN_SUIMAINNET_L2_START_BLOCK', 0),
    // TODO: Replace with actual mainnet BitcoinDepositor contract package and module
    l2ContractAddress: getEnv(
      'CHAIN_SUIMAINNET_L2_CONTRACT_ADDRESS',
      '0x0000000000000000000000000000000000000000000000000000000000000000::bitcoin_depositor', // TODO: Replace with actual mainnet package ID
    ),
    suiPrivateKey: getEnv('CHAIN_SUIMAINNET_SUI_PRIVATE_KEY'),

    // Sui-specific Wormhole and Bridge Object IDs (Mainnet values - ALL NEED TO BE UPDATED)
    // TODO: Replace with actual mainnet Wormhole Core object ID
    wormholeCoreId: getEnv(
      'CHAIN_SUIMAINNET_WORMHOLE_CORE_ID',
      '0x0000000000000000000000000000000000000000000000000000000000000000', // TODO: Get from Wormhole mainnet deployment
    ),
    // TODO: Replace with actual mainnet Token Bridge object ID
    tokenBridgeId: getEnv(
      'CHAIN_SUIMAINNET_TOKEN_BRIDGE_ID',
      '0x0000000000000000000000000000000000000000000000000000000000000000', // TODO: Get from Wormhole mainnet deployment
    ),
    // TODO: Replace with actual mainnet wrapped tBTC coin type
    wrappedTbtcType: getEnv(
      'CHAIN_SUIMAINNET_WRAPPED_TBTC_TYPE',
      '0x0000000000000000000000000000000000000000000000000000000000000000::coin::COIN', // TODO: Get from tBTC mainnet deployment
    ),
    // TODO: Replace with actual mainnet receiver state object ID
    receiverStateId: getEnv(
      'CHAIN_SUIMAINNET_RECEIVER_STATE_ID',
      '0x0000000000000000000000000000000000000000000000000000000000000000', // TODO: Get from BitcoinDepositor mainnet deployment
    ),
    // TODO: Replace with actual mainnet gateway state object ID (Wormhole messaging)
    gatewayStateId: getEnv(
      'CHAIN_SUIMAINNET_GATEWAY_STATE_ID',
      '0x0000000000000000000000000000000000000000000000000000000000000000', // TODO: Get from BitcoinDepositor mainnet deployment
    ),
    // TODO: Replace with actual mainnet capabilities object ID
    capabilitiesId: getEnv(
      'CHAIN_SUIMAINNET_CAPABILITIES_ID',
      '0x0000000000000000000000000000000000000000000000000000000000000000', // TODO: Get from BitcoinDepositor mainnet deployment
    ),
    // TODO: Replace with actual mainnet treasury object ID
    treasuryId: getEnv(
      'CHAIN_SUIMAINNET_TREASURY_ID',
      '0x0000000000000000000000000000000000000000000000000000000000000000', // TODO: Get from BitcoinDepositor mainnet deployment
    ),
    // TODO: Replace with actual mainnet token state object ID
    tokenStateId: getEnv(
      'CHAIN_SUIMAINNET_TOKEN_STATE_ID',
      '0x0000000000000000000000000000000000000000000000000000000000000000', // TODO: Get from BitcoinDepositor mainnet deployment
    ),
  };
  return config;
};
