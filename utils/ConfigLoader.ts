import fs from 'fs/promises';
import { ChainConfig, CHAIN_TYPE, NETWORK } from '../types/ChainConfig.type.js';

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
  'vaultAddress',
  'privateKey',
  'useEndpoint',
];

function validateChainConfig(config: any): asserts config is ChainConfig {
  for (const field of REQUIRED_FIELDS) {
    if (config[field] === undefined || config[field] === null) {
      throw new Error(`Missing required field '${field}' in chain config: ${JSON.stringify(config)}`);
    }
  }
  // Enum checks
  if (!Object.values(CHAIN_TYPE).includes(config.chainType)) {
    throw new Error(`Invalid chainType: ${config.chainType}`);
  }
  if (!Object.values(NETWORK).includes(config.network)) {
    throw new Error(`Invalid network: ${config.network}`);
  }
  if (typeof config.l2WormholeChainId !== 'number' || isNaN(config.l2WormholeChainId)) {
    throw new Error(`Invalid l2WormholeChainId: ${config.l2WormholeChainId}`);
  }
}

async function loadFromFile(path: string): Promise<any> {
  const data = await fs.readFile(path, 'utf-8');
  return JSON.parse(data);
}

function loadFromEnv(): any {
  const json = process.env.CHAIN_CONFIG_JSON;
  if (!json) throw new Error('CHAIN_CONFIG_JSON env var not set');
  return JSON.parse(json);
}

function loadLegacyFromEnv(): ChainConfig {
  // Fallback to legacy single-chain env vars
  const requireEnv = (envVar: string) => {
    if (!process.env[envVar]) throw new Error(`Missing env var: ${envVar}`);
    return process.env[envVar] as string;
  };
  return {
    chainType: process.env.CHAIN_TYPE as CHAIN_TYPE,
    network: process.env.NETWORK as NETWORK,
    chainName: process.env.CHAIN_NAME || 'Default Chain',
    l1Rpc: requireEnv('L1_RPC'),
    l2Rpc: requireEnv('L2_RPC'),
    l2WsRpc: process.env.L2_WS_RPC,
    l1ContractAddress: requireEnv('L1_BITCOIN_DEPOSITOR_ADDRESS'),
    l1BitcoinRedeemerAddress: requireEnv('L1_BITCOIN_REDEEMER_ADDRESS'),
    l2BitcoinRedeemerAddress: requireEnv('L2_BITCOIN_REDEEMER_ADDRESS'),
    l2WormholeGatewayAddress: requireEnv('L2_WORMHOLE_GATEWAY_ADDRESS'),
    l2WormholeChainId: parseInt(requireEnv('L2_WORMHOLE_CHAIN_ID')),
    vaultAddress: requireEnv('TBTC_VAULT_ADDRESS'),
    privateKey: requireEnv('PRIVATE_KEY'),
    l2ContractAddress:
      process.env.ENDPOINT_URL === 'true' ? requireEnv('L2_BITCOIN_DEPOSITOR_ADDRESS') : undefined,
    useEndpoint: process.env.ENDPOINT_URL === 'true',
    l2StartBlock: process.env.L2_START_BLOCK ? parseInt(process.env.L2_START_BLOCK) : undefined,
    solanaSignerKeyBase: process.env.SOLANA_KEY_BASE,
    endpointUrl: process.env.ENDPOINT_URL,
  };
}

export async function loadChainConfigs(): Promise<ChainConfig[]> {
  // Priority: file > env var > legacy env
  let configs: any;
  if (process.env.CHAIN_CONFIG_PATH) {
    configs = await loadFromFile(process.env.CHAIN_CONFIG_PATH);
  } else if (process.env.CHAIN_CONFIG_JSON) {
    configs = loadFromEnv();
  } else {
    // Legacy single-chain mode
    const legacy = loadLegacyFromEnv();
    validateChainConfig(legacy);
    return [legacy];
  }
  // Accept either array or single object
  if (!Array.isArray(configs)) configs = [configs];
  await Promise.all(configs.map(async (c) => validateChainConfig(c)));
  return configs;
} 