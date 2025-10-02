module.exports = {
  displayName: 'Service Tests',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['<rootDir>/tests/unit/services/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  setupFilesAfterEnv: ['<rootDir>/setup.ts'],
  // Skip global setup/teardown
  globalSetup: undefined,
  globalTeardown: undefined,
  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,
  // Increase timeout for service tests
  testTimeout: 10000,
};
