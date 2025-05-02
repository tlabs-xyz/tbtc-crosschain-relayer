import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { ChainConfig, ChainType } from '../types/ChainConfig.type';
import { LogError, LogMessage, LogWarning } from './Logs';

// Load environment variables
dotenv.config();

/**
 * Interface for TokenBridge configuration
 */
export interface TokenBridgeConfig {
  tokenBridgeAddress: string;
  emitterChain: number;
  emitterAddress: string;
}

/**
 * Interface for the complete application configuration
 */
export interface AppConfig {
  chains: {
    l1: ChainConfig;
    l2: ChainConfig;
  };
  wormhole: {
    tokenBridge: TokenBridgeConfig;
  };
  database: {
    type: string;
    path: string;
  };
  server: {
    port: number;
    host: string;
  };
}

/**
 * Convert string to boolean
 */
function parseBool(value: string | undefined): boolean {
  if (!value) return false;
  return ['true', 'yes', '1', 'y'].includes(value.toLowerCase());
}

/**
 * Convert string to number
 */
function parseNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Get ChainType from string
 */
function getChainType(chainTypeStr: string | undefined): ChainType {
  if (!chainTypeStr) return ChainType.EVM;

  switch (chainTypeStr.toLowerCase()) {
    case 'evm':
      return ChainType.EVM;
    case 'starknet':
      return ChainType.STARKNET;
    case 'sui':
      return ChainType.SUI;
    case 'solana':
      return ChainType.SOLANA;
    default:
      return ChainType.EVM;
  }
}

/**
 * Load configuration from environment variables
 */
export function loadEnvConfig(): AppConfig {
  try {
    LogMessage('Loading configuration from environment variables');

    // Build L1 chain config (always Ethereum)
    const l1Config: ChainConfig = {
      chainType: getChainType(process.env.L1_CHAIN_TYPE),
      chainName: process.env.L1_CHAIN_NAME || 'Ethereum',
      l1Rpc: process.env.L1_RPC || '',
      l2Rpc: '', // Not applicable for L1
      l1ContractAddress: process.env.L1_CONTRACT_ADDRESS || '',
      l2ContractAddress: '', // Not applicable for L1
      vaultAddress: process.env.L1_VAULT_ADDRESS || '',
      privateKey: process.env.L1_PRIVATE_KEY || '',
      useEndpoint: false, // Not applicable for L1
      endpointUrl: undefined, // Not applicable for L1
      l2StartBlock: 0, // Not applicable for L1
    };

    // Build L2 chain config (can be any supported chain type)
    const l2ChainType = getChainType(process.env.L2_CHAIN_TYPE);

    const l2Config: ChainConfig = {
      chainType: l2ChainType,
      chainName: process.env.L2_CHAIN_NAME || 'Layer 2',
      l1Rpc: process.env.L1_RPC || '', // Same as L1
      l2Rpc: process.env.L2_RPC || '',
      l1ContractAddress: process.env.L1_CONTRACT_ADDRESS || '', // Same as L1
      l2ContractAddress: process.env.L2_CONTRACT_ADDRESS || '',
      vaultAddress: process.env.L1_VAULT_ADDRESS || '', // Same as L1
      privateKey: process.env.L1_PRIVATE_KEY || '', // Same as L1 if not specified
      l2PrivateKey: process.env.L2_PRIVATE_KEY, // Special for non-EVM chains
      useEndpoint: parseBool(process.env.L2_USE_ENDPOINT),
      endpointUrl: process.env.L2_ENDPOINT_URL,
      l2StartBlock: parseNumber(process.env.L2_START_BLOCK, 0),
    };

    // Add Sui-specific properties if the L2 is Sui
    if (l2ChainType === ChainType.SUI) {
      l2Config.receiverStateId = process.env.SUI_RECEIVER_STATE_ID;
      l2Config.gatewayStateId = process.env.SUI_GATEWAY_STATE_ID;
      l2Config.gatewayCapabilitiesId = process.env.SUI_GATEWAY_CAPABILITIES_ID;
      l2Config.treasuryId = process.env.SUI_TREASURY_ID;
      l2Config.wormholeStateId = process.env.SUI_WORMHOLE_STATE_ID;
      l2Config.tokenBridgeStateId = process.env.SUI_TOKEN_BRIDGE_STATE_ID;
      l2Config.tbtcTokenStateId = process.env.SUI_TBTC_TOKEN_STATE_ID;
    }

    // Build token bridge config
    const tokenBridgeConfig: TokenBridgeConfig = {
      tokenBridgeAddress: process.env.WH_TOKEN_BRIDGE_ADDRESS || '',
      emitterChain: parseNumber(process.env.WH_EMITTER_CHAIN, 2),
      emitterAddress: process.env.WH_EMITTER_ADDRESS || '',
    };

    // Build database config
    const databaseConfig = {
      type: process.env.DB_TYPE || 'file',
      path: process.env.DB_PATH || './data',
    };

    // Build server config
    const serverConfig = {
      port: parseNumber(process.env.SERVER_PORT, 3000),
      host: process.env.SERVER_HOST || 'localhost',
    };

    // Validate required fields
    validateConfig(l1Config, l2Config, tokenBridgeConfig);

    // Build complete config
    const config: AppConfig = {
      chains: {
        l1: l1Config,
        l2: l2Config,
      },
      wormhole: {
        tokenBridge: tokenBridgeConfig,
      },
      database: databaseConfig,
      server: serverConfig,
    };

    return config;
  } catch (error: any) {
    LogError(`Failed to load configuration: ${error.message}`, error);
    throw error;
  }
}

/**
 * Load configuration from JSON file
 */
export function loadJsonConfig(configPath: string = 'config.json'): AppConfig {
  try {
    LogMessage(`Loading configuration from ${configPath}`);
    const filePath = path.resolve(process.cwd(), configPath);
    const configData = fs.readFileSync(filePath, 'utf8');
    const config = JSON.parse(configData);

    // Ensure chains structure exists
    if (!config.chains) {
      config.chains = {};
    }

    // Rename ethereum/sui to l1/l2 if using old format
    if (config.chains.ethereum && !config.chains.l1) {
      config.chains.l1 = config.chains.ethereum;
      delete config.chains.ethereum;
    }

    if (config.chains.sui && !config.chains.l2) {
      config.chains.l2 = config.chains.sui;
      delete config.chains.sui;
    }

    // Validate and enforce correct types
    if (config.chains.l1) {
      config.chains.l1.chainType = config.chains.l1.chainType || ChainType.EVM;
    }

    validateConfig(
      config.chains?.l1,
      config.chains?.l2,
      config.wormhole?.tokenBridge
    );

    return config;
  } catch (error: any) {
    LogError(`Failed to load JSON configuration: ${error.message}`, error);
    throw error;
  }
}

/**
 * Validate required configuration fields
 */
function validateConfig(
  l1Config: ChainConfig,
  l2Config: ChainConfig,
  tokenBridgeConfig: TokenBridgeConfig
) {
  const missingFields: string[] = [];

  // Check L1 config (Ethereum)
  if (!l1Config.l1Rpc) missingFields.push('L1_RPC');
  if (!l1Config.l1ContractAddress) missingFields.push('L1_CONTRACT_ADDRESS');
  if (!l1Config.vaultAddress) missingFields.push('L1_VAULT_ADDRESS');
  if (!l1Config.privateKey) missingFields.push('L1_PRIVATE_KEY');

  // Check L2 config (can be EVM or Sui)
  if (!l2Config.l2Rpc) missingFields.push('L2_RPC');
  if (!l2Config.l2ContractAddress) missingFields.push('L2_CONTRACT_ADDRESS');

  // If L2 is Sui, check for Sui-specific private key
  if (l2Config.chainType === ChainType.SUI && !l2Config.l2PrivateKey) {
    missingFields.push('L2_PRIVATE_KEY (required for Sui)');
  }

  // For Sui, check for required object IDs
  if (l2Config.chainType === ChainType.SUI) {
    if (!l2Config.receiverStateId) missingFields.push('SUI_RECEIVER_STATE_ID');
    if (!l2Config.gatewayStateId) missingFields.push('SUI_GATEWAY_STATE_ID');
    if (!l2Config.gatewayCapabilitiesId)
      missingFields.push('SUI_GATEWAY_CAPABILITIES_ID');
    if (!l2Config.wormholeStateId) missingFields.push('SUI_WORMHOLE_STATE_ID');
    if (!l2Config.tokenBridgeStateId)
      missingFields.push('SUI_TOKEN_BRIDGE_STATE_ID');
    if (!l2Config.tbtcTokenStateId)
      missingFields.push('SUI_TBTC_TOKEN_STATE_ID');
  }

  // Check Wormhole config
  if (!tokenBridgeConfig.tokenBridgeAddress)
    missingFields.push('WH_TOKEN_BRIDGE_ADDRESS');
  if (!tokenBridgeConfig.emitterAddress)
    missingFields.push('WH_EMITTER_ADDRESS');

  if (missingFields.length > 0) {
    throw new Error(
      `Missing required configuration fields: ${missingFields.join(', ')}`
    );
  }
}

/**
 * Load the best available configuration
 * Prioritizes environment variables, falls back to JSON file if specified
 */
export function loadConfig(jsonConfigPath?: string): AppConfig {
  try {
    // First try to load from environment variables
    try {
      return loadEnvConfig();
    } catch (envError: any) {
      LogWarning(
        `Failed to load config from environment: ${envError.message}. Falling back to JSON.`
      );

      // Fall back to JSON config if specified
      if (jsonConfigPath) {
        return loadJsonConfig(jsonConfigPath);
      } else {
        // Try default config.json
        try {
          return loadJsonConfig();
        } catch (jsonError) {
          // If both methods fail, throw the original error
          throw envError;
        }
      }
    }
  } catch (error: any) {
    LogError(`Configuration loading failed: ${error.message}`, error);
    throw error;
  }
}
