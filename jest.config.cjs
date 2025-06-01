/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'json', 'node'],
  verbose: true,
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
  testTimeout: 30000,
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  moduleNameMapper: {
    // Rule for @/ aliases: Strip .js if present, then map to <rootDir>
    // Example: @/utils/prisma.js -> <rootDir>/utils/prisma (ts-jest will find .ts)
    '^@/(.*?)(\\.js)?$': '<rootDir>/$1',

    // Rule for relative paths: Strip .js if present
    // Example: ../../utils/Logger.js -> ../../utils/Logger (ts-jest will find .ts)
    '^(\\.\\.?/.*?)(\\.js)?$': '$1',

    // Other specific mappings that don't involve .js extension issues
    '^#ansi-styles$': 'ansi-styles',
  },
  globalSetup: '<rootDir>/jest.global-setup.js',
  globalTeardown: '<rootDir>/jest.global-teardown.js',
  transformIgnorePatterns: ['/node_modules/(?!.*(p-limit|yocto-queue))/', '\\\\.pnp\\.[^\\/]+$'],
  transform: {
    '^.+\\.m?[tj]sx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
};
