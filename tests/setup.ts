// tests/setup.ts - Global test setup for Jest
//
// Sets up global mocks and environment for all test suites.

import { jest } from '@jest/globals';

// =====================
// Environment Setup
// =====================
// Environment variable assignments removed, now handled in tests/test-environment.ts

// =====================
// Global SDK Mock
// =====================
const actualSdk = jest.requireActual('@wormhole-foundation/sdk') as any;
jest.mock('@wormhole-foundation/sdk', () => {
  return {
    __esModule: true,
    ...actualSdk,
    wormhole: jest.fn(),
    chainIdToChain: jest.fn((...args) => actualSdk.chainIdToChain(...args)),
  };
});
