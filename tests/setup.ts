console.log('[tests/setup.ts] Minimal version - providing mock helpers only');

import { jest } from '@jest/globals';

// (global as any).CONSTRUCTOR_CALL_COUNT = 0; // No longer tracking JsonRpcProvider constructor

// --- Global SDK Mock ---
const actualSdk = jest.requireActual('@wormhole-foundation/sdk') as any;
jest.mock('@wormhole-foundation/sdk', () => {
  console.log('[tests/setup.ts] EXECUTING @wormhole-foundation/sdk mock factory');
  return {
    __esModule: true,
    ...actualSdk,
    wormhole: jest.fn(),
    chainIdToChain: jest.fn((...args) => actualSdk.chainIdToChain(...args)),
  };
});

// Conditional Service Mock (Commented out)

// Set up environment variables for tests
process.env.LOG_LEVEL = 'debug';
process.env.NODE_ENV = 'test';

console.log('[tests/setup.ts] Finished execution (Minimal - SDK mock only)');
