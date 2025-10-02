module.exports = {
  displayName: 'TBTC Relayer Tests',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: [
    '<rootDir>/tests/**/*.test.ts',
    '<rootDir>/tests/**/*.test.js'
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'services/**/*.ts',
    'handlers/**/*.ts',
    'controllers/**/*.ts',
    'utils/**/*.ts',
    'config/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  globalSetup: '<rootDir>/jest.global-setup.js',
  globalTeardown: '<rootDir>/jest.global-teardown.js',
  // Database configuration for tests
  testEnvironmentOptions: {
    database: {
      url: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/tbtc_relayer_test',
    },
  },
  // Timeout for database operations
  testTimeout: 30000,
  // Run tests in sequence to avoid database conflicts
  maxWorkers: 1,
  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,
};
