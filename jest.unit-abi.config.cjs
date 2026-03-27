/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'json', 'node'],
  verbose: true,
  forceExit: true,
  testTimeout: 30000,
  moduleNameMapper: {
    '^(\\.{1,2}/(?!v\\d+/).*?)\\.js$': '$1',
  },
  transform: {
    '^.+\\.m?[tj]sx?$': ['ts-jest', { useESM: true }],
  },
};
