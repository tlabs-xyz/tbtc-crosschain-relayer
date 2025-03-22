/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
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
    '^@/(.*)$': '<rootDir>/$1',
  },
  globals: {
    'ts-jest': {
      isolatedModules: true,
    },
  },
}; 