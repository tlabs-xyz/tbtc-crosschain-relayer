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
      '0x3d78316ce8ee3fe48d7ff85cdc2d0df9d459f43d802d96f58f7b59984c2dd3ae::bitcoin_depositor',
    ),
    suiPrivateKey: getEnv('CHAIN_SUITESTNET_SUI_PRIVATE_KEY'),

    // Sui-specific Wormhole and Bridge Object IDs (Testnet values)
    wormholeCoreId: getEnv(
      'CHAIN_SUITESTNET_WORMHOLE_CORE_ID',
      '0x31358d198147da50db32eda2562951d53973a0c0ad5ed738e9b17d88b213d790',
    ),
    tokenBridgeId: getEnv(
      'CHAIN_SUITESTNET_TOKEN_BRIDGE_ID',
      '0x6fb10cdb7aa299e9a4308752dadecb049ff55a892de92992a1edbd7912b3d6da',
    ),
    wrappedTbtcType: getEnv(
      'CHAIN_SUITESTNET_WRAPPED_TBTC_TYPE',
      '0xb501e7f0b86ad34eb634835069be3dad295b6a4af139986bcd5447f1ad0a2b94::coin::COIN',
    ),
    receiverStateId: getEnv(
      'CHAIN_SUITESTNET_RECEIVER_STATE_ID',
      '0x10f421d7960be14c07057fd821332ee8a9d717873c62e7fa370fa99913e8e924',
    ),
    gatewayStateId: getEnv(
      'CHAIN_SUITESTNET_GATEWAY_STATE_ID',
      '0x19ab17536712e3e2efa9a1c01acbf5c09ae53e969cb9046dc382f5f49b603d52',
    ),
    capabilitiesId: getEnv(
      'CHAIN_SUITESTNET_CAPABILITIES_ID',
      '0xeb0857599ce78686a8e01f4fbb4356151697610cf9f8ea8469581ad326c89425',
    ),
    treasuryId: getEnv(
      'CHAIN_SUITESTNET_TREASURY_ID',
      '0xa7f1115226db843a59c3ae554ce4b7cf32648bf705ab543c85759cc1f56e1b78',
    ),
    tokenStateId: getEnv(
      'CHAIN_SUITESTNET_TOKEN_STATE_ID',
      '0x0d59e4970772269ee917280da592089c7de389ed67164ce4c07ed508917fdf08',
    ),
  };
  return config;
};

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
