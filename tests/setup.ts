// Set environment variables for testing
process.env.NODE_ENV = 'test';
process.env.APP_NAME = 'tBTC Relayer Test';
process.env.VERBOSE_APP = 'false'; // Disable verbose logging during tests
process.env.CLEAN_QUEUED_TIME = '1'; // 1 hour for faster testing
process.env.CLEAN_FINALIZED_TIME = '1'; // 1 hour for faster testing
process.env.CLEAN_BRIDGED_TIME = '1'; // 1 hour for faster testing

// --- Application Configuration ---
process.env.APP_VERSION = '1.0.0-test';
process.env.API_ONLY_MODE = 'true';
process.env.ENABLE_CLEANUP_CRON = 'false';

// --- Server Ports ---
process.env.HOST_PORT = '4001'; // Different port for tests
process.env.APP_PORT = '3001'; // Different port for tests

// --- CORS ---
process.env.CORS_ENABLED = 'true';
process.env.CORS_URL = 'http://localhost:4001';

// --- Storage ---
process.env.JSON_PATH = './test-data/';

// --- Database Configuration ---
// Check if we're in CI environment (DATABASE_URL already set) or local development
const isCI = process.env.CI === 'true' || process.env.DATABASE_URL?.includes('postgres:5432');

if (!isCI && !process.env.DATABASE_URL) {
  // Local test database configuration
  process.env.POSTGRES_HOST = 'localhost';
  process.env.POSTGRES_PORT = '5433'; // Different port for test DB
  process.env.POSTGRES_USER = 'test_user';
  process.env.POSTGRES_PASSWORD = 'test_password';
  process.env.POSTGRES_DB = 'tbtc_relayer_test';
  process.env.DATABASE_URL =
    'postgresql://test_user:test_password@localhost:5433/tbtc_relayer_test?schema=public';
}
// If DATABASE_URL is already set (CI environment), keep the existing database config
// but ensure other database-related env vars are consistent
else if (process.env.DATABASE_URL) {
  const url = new URL(process.env.DATABASE_URL);
  process.env.POSTGRES_HOST = url.hostname;
  process.env.POSTGRES_PORT = url.port || '5432';
  process.env.POSTGRES_USER = url.username;
  process.env.POSTGRES_PASSWORD = url.password;
  process.env.POSTGRES_DB = url.pathname.slice(1); // Remove leading slash
}

// --- Supported Chains (Limited set for testing) ---
process.env.SUPPORTED_CHAINS = 'sepoliaTestnet,solanaDevnet';

// =============================================================================
// --- MOCK CHAIN PRIVATE KEYS ---
// =============================================================================
// These are test/mock keys that should NEVER be used on real networks

// --- EVM Chain Mock Keys ---
process.env.CHAIN_SEPOLIATESTNET_PRIVATE_KEY =
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
process.env.CHAIN_ARBITRUMMAINNET_PRIVATE_KEY =
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
process.env.CHAIN_BASEMAINNET_PRIVATE_KEY =
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
process.env.CHAIN_BASESEPOLIATESTNET_PRIVATE_KEY =
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

// --- Non-EVM Chain Mock Keys ---
process.env.CHAIN_SOLANADEVNET_PRIVATE_KEY = '5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3'; // Mock base58 key
process.env.CHAIN_STARKNETTESTNET_PRIVATE_KEY =
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
process.env.CHAIN_SUITESTNET_PRIVATE_KEY =
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

// --- Legacy/Imported Configuration Mock Keys ---
process.env.CHAIN_SOLANADEVNETIMPORTED_SOLANA_PRIVATE_KEY =
  '5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3';

// =============================================================================
// --- MOCK RPC CONFIGURATION ---
// =============================================================================

// --- Mock Ethereum L1 RPC URLs ---
process.env.ETHEREUM_MAINNET_RPC = 'https://mock-ethereum-mainnet.test.com';
process.env.ETHEREUM_SEPOLIA_RPC = 'https://mock-ethereum-sepolia.test.com';

// --- Mock EVM L2 RPC URLs ---
process.env.CHAIN_ARBITRUMMAINNET_L2_RPC = 'https://mock-arbitrum.test.com';
process.env.CHAIN_ARBITRUMMAINNET_L2_WS_RPC = 'wss://mock-arbitrum-ws.test.com';
process.env.CHAIN_BASEMAINNET_L2_RPC = 'https://mock-base.test.com';
process.env.CHAIN_BASEMAINNET_L2_WS_RPC = 'wss://mock-base-ws.test.com';
process.env.CHAIN_BASESEPOLIATESTNET_L2_RPC = 'https://mock-base-sepolia.test.com';
process.env.CHAIN_BASESEPOLIATESTNET_L2_WS_RPC = 'wss://mock-base-sepolia-ws.test.com';

// --- Mock Legacy Configuration ---
process.env.CHAIN_SOLANADEVNETIMPORTED_L2_RPC = 'https://mock-solana-devnet.test.com';
process.env.CHAIN_SOLANADEVNETIMPORTED_L2_WS_RPC = 'wss://mock-solana-devnet-ws.test.com';

// =============================================================================
// --- MOCK BLOCK CONFIGURATION ---
// =============================================================================

// --- Mock Start Blocks (set to reasonable test values) ---
process.env.CHAIN_ARBITRUMMAINNET_L2_START_BLOCK = '1000000';
process.env.CHAIN_BASEMAINNET_L2_START_BLOCK = '1000000';
process.env.CHAIN_BASESEPOLIATESTNET_L2_START_BLOCK = '1000000';
process.env.CHAIN_SOLANADEVNETIMPORTED_L2_START_BLOCK = '1000000';

// --- Mock L1 Confirmations (set to 1 for faster tests) ---
process.env.CHAIN_ARBITRUMMAINNET_L1_CONFIRMATIONS = '1';
process.env.CHAIN_BASEMAINNET_L1_CONFIRMATIONS = '1';
process.env.CHAIN_BASESEPOLIATESTNET_L1_CONFIRMATIONS = '1';
