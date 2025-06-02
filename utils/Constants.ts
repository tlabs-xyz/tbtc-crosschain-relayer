import type { NETWORK } from '../config/schemas/common.schema.js';

export const DEFAULT_APP_NAME = 'tBTC Cross-Chain Relayer';

export const ENV_NETWORK = process.env.NETWORK as NETWORK;

// Timeouts and retry configuration (in milliseconds)
export const TIMEOUTS = {
  DEFAULT_DEPOSIT_RETRY_MS: 1000 * 60 * 5, // 5 minutes
  L1_TX_CONFIRMATION_TIMEOUT_MS: 300000, // 5 minutes
  VAA_FETCH_TIMEOUT_MS: 300000, // 5 minutes
  DEFAULT_REQUEST_TIMEOUT_MS: 60000, // 1 minute
} as const;

// Gas and transaction configuration
export const GAS_CONFIG = {
  GAS_ESTIMATE_MULTIPLIER: 1.2, // 20% buffer
  DEFAULT_GAS_LIMIT: 500000,
} as const;

// Cleanup timeouts (in hours, converted to milliseconds internally)
export const CLEANUP_CONFIG = {
  REMOVE_QUEUED_TIME_HOURS: 48,
  REMOVE_FINALIZED_TIME_HOURS: 12,
  REMOVE_BRIDGED_TIME_HOURS: 12,
  REDEMPTION_RETENTION_DAYS: 7,
} as const;

// Convert cleanup hours to milliseconds for internal use
export const CLEANUP_TIMEOUTS_MS = {
  REMOVE_QUEUED_TIME_MS: CLEANUP_CONFIG.REMOVE_QUEUED_TIME_HOURS * 60 * 60 * 1000,
  REMOVE_FINALIZED_TIME_MS: CLEANUP_CONFIG.REMOVE_FINALIZED_TIME_HOURS * 60 * 60 * 1000,
  REMOVE_BRIDGED_TIME_MS: CLEANUP_CONFIG.REMOVE_BRIDGED_TIME_HOURS * 60 * 60 * 1000,
  REDEMPTION_RETENTION_MS: CLEANUP_CONFIG.REDEMPTION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
} as const;

// Blockchain configuration
export const BLOCKCHAIN_CONFIG = {
  MIN_VAA_CONSISTENCY_LEVEL: 1,
  DEFAULT_L1_CONFIRMATIONS: 1,
  DEFAULT_L1_CHAIN_ID: 2, // Ethereum Mainnet
  ETHEREUM_MAINNET_CHAIN_ID: 2,
} as const;

// Protocol constants
export const PROTOCOL_CONFIG = {
  EXPECTED_PROTOCOL_NAME: 'TokenBridge',
  SUPPORTED_PAYLOAD_NAMES: ['TokenBridge:Transfer', 'TokenBridge:TransferWithPayload'] as const,
  SUPPORTED_DISCRIMINATORS: ['TokenBridge:TransferWithPayload', 'TokenBridge:Transfer'] as const,
} as const;

// Default limits and boundaries
export const LIMITS = {
  DEFAULT_PAST_EVENTS_QUERY_LIMIT: 1000,
  DEFAULT_START_BLOCK_OFFSET: 0,
  MAX_RETRIES: 5,
  DEFAULT_RETRY_DELAY_MS: 5000,
  JSON_PAYLOAD_LIMIT: '8mb',
} as const;

// Environment validation constants
export const ENV_VALIDATION = {
  VALID_BOOLEAN_VALUES: ['true', 'false'] as const,
  MIN_PRIVATE_KEY_LENGTH: 64,
} as const;

// Type exports for better type safety
export type SupportedPayloadName = (typeof PROTOCOL_CONFIG.SUPPORTED_PAYLOAD_NAMES)[number];
export type SupportedDiscriminator = (typeof PROTOCOL_CONFIG.SUPPORTED_DISCRIMINATORS)[number];
