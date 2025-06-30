/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'json', 'node'],
  verbose: true,
  forceExit: true,
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
    // eslint-disable-next-line no-useless-escape
    '^(\.{1,2}/.+)\.js$': '$1',
    '^@/(.*)$': '<rootDir>/$1',
  },
  globalSetup: '<rootDir>/jest.global-setup.js',
  globalTeardown: '<rootDir>/jest.global-teardown.js',
  transformIgnorePatterns: [
    '/node_modules/(?!.*(p-limit|yocto-queue|@mysten))/',
    '\\.pnp\\.[^\\/]+$',
  ],
  transform: {
    '^.+\\.m?[tj]sx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
};
