// jest.global-setup.js - Jest global setup for tBTC cross-chain relayer
//
// This script prepares the test environment before Jest runs any tests.
// It sets up environment variables, resets the test database, generates Prisma client, and writes mock chain configs.

import './tests/test-environment.ts'; // Import test environment to load DATABASE_URL and other env vars
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { allMockChainConfigs } from './tests/mocks/mock.chain.configs.ts';

// dotenv.config({ path: '.env.test' }); // Removed: Env vars now loaded from tests/setup.ts

// =====================
// Default Environment Variables
// =====================

// Default environment variables for tests if not already set
const defaultTestEnv = {
  CHAIN_SEPOLIATESTNET_L1_RPC: 'mock_sepolia_l1_rpc_url',
  STARKNET_TESTNET_L2_RPC: 'mock_starknet_testnet_l2_rpc_url',
  STARKNET_TESTNET_L1_CONTRACT_ADDRESS: '0xMockStarknetL1ContractAddress000000000',
  CHAIN_SEPOLIATESTNET_L1_REDEEMER_ADDRESS: '0xMockSepoliaL1RedeemerAddress0000000',
  CHAIN_STARKNETTESTNET_PRIVATE_KEY:
    '0x0000000000000000000000000000000000000000000000000000000000000001',
  CHAIN_STARKNETTESTNET_DEPLOYER_ADDRESS:
    '0x0000000000000000000000000000000000000000000000000000000000000001',
  STARKNET_TESTNET_L2_WS_RPC: '',
  STARKNET_TESTNET_L2_WORMHOLE_GATEWAY_ADDRESS: '',
  STARKNET_TESTNET_L2_WORMHOLE_CHAIN_ID: '0',
  LOG_LEVEL: 'debug',
  API_ONLY_MODE: 'true',
  ENABLE_CLEANUP_CRON: 'false',
};

for (const [key, value] of Object.entries(defaultTestEnv)) {
  if (!process.env[key]) {
    process.env[key] = value;
    console.log(`Jest Global Setup: Set default ENV VAR ${key}=${process.env[key]}`);
  }
}

const MOCK_CONFIG_DIR = path.join(__dirname, 'config', 'chain');

// =====================
// Jest Global Setup Function
// =====================

export default async () => {
  console.log('\nJest Global Setup: Loading test environment variables...');

  // =====================
  // Database Reset & Prisma Client Generation
  // =====================
  try {
    console.log(
      'Jest Global Setup: Resetting and synchronizing test database with Prisma schema...',
    );
    // Ensure DATABASE_URL is set, typically from .env.test loaded by dotenv
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set. Ensure .env.test is configured correctly.');
    }
    execSync('npx prisma db push --force-reset --accept-data-loss', {
      stdio: 'inherit',
      env: { ...process.env },
    });
    console.log('Jest Global Setup: Test database reset and synchronized successfully.');

    // Explicitly regenerate Prisma Client for tests
    console.log('Jest Global Setup: Regenerating Prisma Client for tests...');
    execSync('npx prisma generate --schema=./prisma/schema.prisma', {
      stdio: 'inherit',
      env: { ...process.env },
    });
    console.log('Jest Global Setup: Prisma Client for tests regenerated successfully.');
  } catch (error) {
    console.error('Jest Global Setup: Failed to reset test database or generate client:', error);
    // Decide if you want to throw the error and stop the test run, or try to continue
    // For CI/CD, it's generally better to fail fast if the DB setup fails.
    throw error;
  }

  // =====================
  // Mock Chain Config Setup
  // =====================

  // Ensure SUPPORTED_CHAINS includes the mock chains
  const mockChainNames = allMockChainConfigs.map((config) => config.chainName).join(',');
  process.env.SUPPORTED_CHAINS = mockChainNames;
  console.log(`Jest Global Setup: SUPPORTED_CHAINS set to: ${process.env.SUPPORTED_CHAINS}`);

  // Create mock config directory if it doesn't exist
  if (!fs.existsSync(MOCK_CONFIG_DIR)) {
    fs.mkdirSync(MOCK_CONFIG_DIR, { recursive: true });
    console.log(`Jest Global Setup: Created mock config directory: ${MOCK_CONFIG_DIR}`);
  }

  // Write mock chain configurations to JSON files
  allMockChainConfigs.forEach((config) => {
    const filePath = path.join(MOCK_CONFIG_DIR, `${config.chainName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
    console.log(`Jest Global Setup: Wrote mock config for ${config.chainName} to ${filePath}`);
  });

  // Log all environment variables that Jest will use
  // console.log('Jest Global Setup: Final Environment Variables:');
  // Object.keys(process.env).forEach(key => {
  //   console.log(`${key}: ${process.env[key]}`);
  // });

  // =====================
  // Finalization
  // =====================

  // Set a global variable that can be accessed in tests to confirm setup ran
  globalThis.jestGlobalSetupExecuted = true;
  console.log('Jest Global Setup: Completed.');
};
