// jest.config.cjs - Jest configuration for tBTC cross-chain relayer
//
// This file configures Jest for TypeScript, ESM, and custom mocking for the relayer project.
// It sets up coverage, module resolution, test environment, and transform rules for robust testing.

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  // =====================
  // Core Jest Settings
  // =====================
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'json', 'node'],
  verbose: true,

  // =====================
  // Coverage Settings
  // =====================
  collectCoverageFrom: [
    'controllers/**/*.ts',
    'handlers/**/*.ts',
    'helpers/**/*.ts',
    'services/**/*.ts',
    'utils/**/*.ts',
    'routes/**/*.ts',
    '!**/node_modules/**',
    '!**/dist/**',
  ],
  coverageDirectory: 'coverage',

  // =====================
  // Test Timeout & Setup
  // =====================
  testTimeout: 30000,
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],

  // =====================
  // Module Name Mapping
  // =====================
  moduleNameMapper: {
    // Force imports of 'ethers' to resolve to our mock file
    '^ethers$': '<rootDir>/tests/mocks/ethers.mock.ts',
    // Map @ethersproject/experimental to our custom mock
    '^@ethersproject/experimental$': '<rootDir>/tests/mocks/ethersprojectExperimental.mock.ts',
    // Rule for @/ aliases: Strip .js if present, then map to <rootDir>
    '^@/(.*?)(\\.js)?$': '<rootDir>/$1',
    // Rule for relative paths: Strip .js if present
    '^(\.{1,2}/.+)\\.js$': '$1',
    // Other specific mappings that don't involve .js extension issues
    '^#ansi-styles$': 'ansi-styles',
  },

  // =====================
  // Global Setup/Teardown
  // =====================
  globalSetup: '<rootDir>/jest.global-setup.js',
  globalTeardown: '<rootDir>/jest.global-teardown.js',

  // =====================
  // Transform & Ignore Patterns
  // =====================
  transformIgnorePatterns: ['/node_modules/(?!.*(p-limit|yocto-queue))/', '\\.pnp\.[^\/]+$'],
  transform: {
    '^.+\\.m?[tj]sx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
};
