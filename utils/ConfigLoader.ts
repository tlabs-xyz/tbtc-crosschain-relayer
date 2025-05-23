import fs from 'fs'; // Use fs.promises
import { logErrorContext } from './Logger.js';
import logger from './Logger.js';
import type { ChainConfig } from '../types/ChainConfig.type.js';
import { CHAIN_TYPE, NETWORK } from '../types/ChainConfig.type.js';

const REQUIRED_FIELDS: (keyof ChainConfig)[] = [
  'chainType',
  'network',
  'chainName',
  'l1Rpc',
  'l2Rpc',
  'l1ContractAddress',
  'l1BitcoinRedeemerAddress',
  'l2BitcoinRedeemerAddress',
  'l2WormholeGatewayAddress',
  'l2WormholeChainId',
  'privateKey',
  // vaultAddress is optional
  // useEndpoint is optional (defaults to false in validateChainConfig)
];

function validateChainConfig(config: any): ChainConfig {
  const missingFields = REQUIRED_FIELDS.filter(field => config[field] === undefined || config[field] === null);
  if (missingFields.length > 0) {
    throw new Error(`Missing required fields: ${missingFields.join(', ')} in chain config: ${JSON.stringify(config)}`);
  }
  if (!Object.values(CHAIN_TYPE).includes(config.chainType)) {
    throw new Error(`Invalid chainType: ${config.chainType}`);
  }
  if (!Object.values(NETWORK).includes(config.network)) {
    throw new Error(`Invalid network: ${config.network}`);
  }
  if (typeof config.l2WormholeChainId !== 'number' || isNaN(config.l2WormholeChainId)) {
    throw new Error(`Invalid l2WormholeChainId: ${config.l2WormholeChainId}`);
  }
  if (config.chainType === CHAIN_TYPE.SOLANA && !config.solanaPrivateKey) {
    // It's optional, so just a warning if missing, not an error.
    logger.warn(`solanaPrivateKey is missing for Solana chain: ${config.chainName}. Operations requiring it may fail.`);
  }
  // Add default for useEndpoint if not present
  if (config.useEndpoint === undefined) {
    config.useEndpoint = false;
  }

  // Default and validate supportsRevealDepositAPI
  if (config.supportsRevealDepositAPI === undefined) {
    config.supportsRevealDepositAPI = false;
  }
  if (typeof config.supportsRevealDepositAPI !== 'boolean') {
    const errorMsg = `Invalid type for supportsRevealDepositAPI for chain ${config.chainName || '(unknown name)'}: Expected boolean, got ${typeof config.supportsRevealDepositAPI}`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  return config as ChainConfig;
}

function loadLegacyFromEnv(): Partial<ChainConfig> {
  const envChainConfig: Partial<ChainConfig> = {};
  if (process.env.CHAIN_TYPE) envChainConfig.chainType = process.env.CHAIN_TYPE as CHAIN_TYPE;
  if (process.env.NETWORK) envChainConfig.network = process.env.NETWORK as NETWORK;
  if (process.env.CHAIN_NAME) envChainConfig.chainName = process.env.CHAIN_NAME;
  if (process.env.L1_RPC) envChainConfig.l1Rpc = process.env.L1_RPC;
  if (process.env.L2_RPC) envChainConfig.l2Rpc = process.env.L2_RPC;
  if (process.env.L2_WS_RPC) envChainConfig.l2WsRpc = process.env.L2_WS_RPC;
  if (process.env.L1_BITCOIN_DEPOSITOR_ADDRESS) envChainConfig.l1ContractAddress = process.env.L1_BITCOIN_DEPOSITOR_ADDRESS;
  if (process.env.L1_BITCOIN_REDEEMER_ADDRESS) envChainConfig.l1BitcoinRedeemerAddress = process.env.L1_BITCOIN_REDEEMER_ADDRESS;
  if (process.env.L2_BITCOIN_REDEEMER_ADDRESS) envChainConfig.l2BitcoinRedeemerAddress = process.env.L2_BITCOIN_REDEEMER_ADDRESS;
  if (process.env.L2_WORMHOLE_GATEWAY_ADDRESS) envChainConfig.l2WormholeGatewayAddress = process.env.L2_WORMHOLE_GATEWAY_ADDRESS;
  if (process.env.L2_WORMHOLE_CHAIN_ID) envChainConfig.l2WormholeChainId = parseInt(process.env.L2_WORMHOLE_CHAIN_ID);
  if (process.env.TBTC_VAULT_ADDRESS) envChainConfig.vaultAddress = process.env.TBTC_VAULT_ADDRESS; // Keep for legacy load, but it's optional
  if (process.env.PRIVATE_KEY) envChainConfig.privateKey = process.env.PRIVATE_KEY;
  if (process.env.USE_ENDPOINT) envChainConfig.useEndpoint = process.env.USE_ENDPOINT === 'true';
  if (process.env.L2_START_BLOCK) envChainConfig.l2StartBlock = parseInt(process.env.L2_START_BLOCK);
  if (process.env.SOLANA_PRIVATE_KEY) envChainConfig.solanaPrivateKey = process.env.SOLANA_PRIVATE_KEY;
  if (process.env.SOLANA_COMMITMENT) envChainConfig.solanaCommitment = process.env.SOLANA_COMMITMENT as 'processed' | 'confirmed' | 'finalized';

  const coreLegacyFieldsSet = [
    envChainConfig.chainType,
    envChainConfig.network,
    envChainConfig.l1Rpc,
    envChainConfig.l2Rpc,
    envChainConfig.privateKey
  ].every(field => field !== undefined);

  if (coreLegacyFieldsSet) {
    envChainConfig.chainName = envChainConfig.chainName || `LegacyDefault-${envChainConfig.chainType}`;
    return envChainConfig;
  }
  return {}; 
}

const CHAIN_CONFIG_PATH = process.env.CHAIN_CONFIG_PATH || 'chain-config.json';
const TEST_CHAIN_CONFIG_PATH = 'test-chain-config.json';

function getMockChainConfig(chainName = 'MockEVM', chainType: CHAIN_TYPE = CHAIN_TYPE.EVM): ChainConfig {
  // Base config without chain-specific Solana fields or other truly optional fields like vaultAddress
  const baseMockConfig: any = {
    chainName: chainName,
    chainType: chainType,
    network: NETWORK.TESTNET,
    l1Rpc: 'http://localhost:8545',
    l1ContractAddress: '0xMockL1Contract',
    l1BitcoinRedeemerAddress: '0xMockL1Redeemer',
    l2BitcoinRedeemerAddress: chainType === CHAIN_TYPE.EVM ? '0xMockL2Redeemer' : 'GMockL2RedeemerSolana', // Make distinct for clarity
    l2WormholeGatewayAddress: chainType === CHAIN_TYPE.EVM ? '0xMockWormholeGateway' : 'EMockWormholeGatewaySolana',
    l2WormholeChainId: chainType === CHAIN_TYPE.EVM ? 2001 : 3001, // Using IDs from test-chain-config for consistency
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    l2Rpc: chainType === CHAIN_TYPE.EVM ? 'http://localhost:8546' : 'http://localhost:8899',
    useEndpoint: false, // Default to false for mocks
    supportsRevealDepositAPI: chainType === CHAIN_TYPE.EVM, // Default to true for EVM mocks, false otherwise for testing
    // vaultAddress is not included as it's optional
  };

  if (chainType === CHAIN_TYPE.SOLANA) {
    baseMockConfig.solanaPrivateKey = '2TBg3QFM79zto8iue6zS3s5C3x8Y5tYt7X9XgWfXmG8qM7f3sE6qT6pU8nL3dG9qS7jZ1vC4aW8kP5hN2xJ3';
    baseMockConfig.solanaCommitment = 'confirmed';
  }
  return baseMockConfig as ChainConfig; // Validate will ensure it's truly ChainConfig
}

export async function loadChainConfigs(): Promise<ChainConfig[]> {
  if (process.env.NODE_ENV === 'test') {
    try {
      await fs.promises.access(TEST_CHAIN_CONFIG_PATH, fs.constants.F_OK);
      const data = await fs.promises.readFile(TEST_CHAIN_CONFIG_PATH, 'utf-8');
      const configs = JSON.parse(data) as any[];
      logger.info(`Loaded test chain configurations from ${TEST_CHAIN_CONFIG_PATH}`);
      return configs.map(c => validateChainConfig(c));
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        logger.info(`${TEST_CHAIN_CONFIG_PATH} not found. Falling back to default single mock EVM chain for tests.`);
      } else {
        logErrorContext(`Failed to load or parse test chain configurations from ${TEST_CHAIN_CONFIG_PATH}. Error:`, error);
        logger.warn('Falling back to default single mock EVM chain for tests.');
      }
      return [validateChainConfig(getMockChainConfig('MockEVM1', CHAIN_TYPE.EVM))]; // Use name from test file
    }
  }

  if (process.env.CHAIN_CONFIG_JSON_ENV) {
    try {
      logger.info('Loading chain configurations from CHAIN_CONFIG_JSON_ENV environment variable.');
      let configsToParse = JSON.parse(process.env.CHAIN_CONFIG_JSON_ENV);
      if (!Array.isArray(configsToParse)) configsToParse = [configsToParse];
      return configsToParse.map((c: any) => validateChainConfig(c));
    } catch (error) {
      logErrorContext('Failed to parse CHAIN_CONFIG_JSON_ENV. Error:', error);
      logger.warn(`Proceeding without chains from CHAIN_CONFIG_JSON_ENV.`);
    }
  }

  try {
    await fs.promises.access(CHAIN_CONFIG_PATH, fs.constants.F_OK);
    const data = await fs.promises.readFile(CHAIN_CONFIG_PATH, 'utf-8');
    logger.info(`Loading chain configurations from file: ${CHAIN_CONFIG_PATH}`);
    let configsToParse = JSON.parse(data);
    if (!Array.isArray(configsToParse)) configsToParse = [configsToParse];
    return configsToParse.map((c: any) => validateChainConfig(c));
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      logger.info(
        `Chain config file not found at ${CHAIN_CONFIG_PATH}. Checking for legacy environment variables.`,
      );
    } else {
      logErrorContext(
        `Failed to load or parse chain configurations from ${CHAIN_CONFIG_PATH}. Error:`,
        error,
      );
      logger.warn('Checking for legacy environment variables as a fallback.');
    }
  }

  const legacyConfigData = loadLegacyFromEnv();
  if (Object.keys(legacyConfigData).length > 0 && REQUIRED_FIELDS.every(rf => legacyConfigData[rf] !== undefined || rf === 'vaultAddress' || rf === 'useEndpoint')) {
    try {
        const validatedLegacyConfig = validateChainConfig(legacyConfigData);
        logger.info('Using single-chain configuration from legacy environment variables.');
        return [validatedLegacyConfig];
    } catch(validationError) {
        logErrorContext('Legacy environment variables formed an invalid configuration:', validationError);
    }
  }

  logger.error('No valid chain configurations found. The relayer may not operate correctly. Please provide a config file (chain-config.json), set CHAIN_CONFIG_JSON_ENV, or set legacy single-chain environment variables.');
  return [];
} 