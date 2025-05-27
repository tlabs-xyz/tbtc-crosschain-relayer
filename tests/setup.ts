import { jest } from '@jest/globals';

// --- Global SDK Mock ---
// This mock is always active. It replaces the actual 'wormhole' function from the SDK
// with a Jest mock function. Other parts of the SDK can be used as originals or mocked further if needed.
const actualSdk = jest.requireActual('@wormhole-foundation/sdk') as any;

jest.mock('@wormhole-foundation/sdk', () => {
  // Dynamically get the original SDK to ensure we have the latest version of its exports
  // Note: jest.requireActual needs to be called outside the mock factory's scope if used directly for all exports.
  // Here, we define specific mocks and can use 'actualSdk' for passthroughs.
  return {
    __esModule: true, // For ES Modules compatibility
    ...actualSdk, // Spread all original SDK exports first
    wormhole: jest.fn(), // Override 'wormhole' with a Jest mock function
    // If specific control over chainIdToChain or UniversalAddress is needed globally, mock them here too.
    // For now, relying on the spread to pass through the originals, individual tests can re-mock if necessary.
    // Example: chainIdToChain: jest.fn((...args) => actualSdk.chainIdToChain(...args)),
    chainIdToChain: jest.fn((...args) => actualSdk.chainIdToChain(...args)), // Ensure this is a mock for tests to implement
  };
});

// --- Conditional WormholeVaaService Mock ---
// This allows specific E2E tests (that set this env var) to use the actual service,
// while other tests (unit/integration) get the mock for WormholeVaaService itself by default.
if (process.env.USE_REAL_WORMHOLE_SERVICE !== 'true') {
  console.log(
    '[tests/setup.ts] Mocking WormholeVaaService CLASS. USE_REAL_WORMHOLE_SERVICE is not true.',
  );
  jest.mock('../services/WormholeVaaService', () => ({
    WormholeVaaService: {
      getInstance: jest.fn().mockReturnValue({
        fetchAndVerifyVaaForL2Event: jest.fn().mockImplementation(async (l2TxHash) => {
          console.log(
            `[GLOBAL MOCK WormholeVaaService.getInstance().fetchAndVerifyVaaForL2Event] Called for L2 Tx: ${l2TxHash}`,
          );
          return null;
        }),
      }),
      create: jest.fn().mockImplementation(async (...args: any[]) => {
        console.log('[GLOBAL MOCK WormholeVaaService.create CALLED] Args:', args);
        return {
          fetchAndVerifyVaaForL2Event: jest.fn().mockImplementation(async (l2TxHash) => {
            console.log(
              `[GLOBAL MOCK WormholeVaaService.create().fetchAndVerifyVaaForL2Event] Called for L2 Tx: ${l2TxHash}. this.wh is ${JSON.stringify(
                (this as any).wh,
              )}`,
            );
            if (!(this as any).wh) {
              console.error(
                '[GLOBAL MOCK WormholeVaaService.create().fetchAndVerifyVaaForL2Event] CRITICAL: this.wh is undefined.',
              );
            }
            return null;
          }),
        };
      }),
    },
  }));
} else {
  console.log(
    '[tests/setup.ts] NOT Mocking WormholeVaaService CLASS. USE_REAL_WORMHOLE_SERVICE is true.',
  );
  // Intentionally not mocking WormholeVaaService class, so the actual service will be used.
  // It will, however, pick up the globally mocked '@wormhole-foundation/sdk' due to the mock above.
}

// Set environment variables for testing
// Ensure any critical env vars for the service (even when SDK is mocked) are set.
// e.g., process.env.L2_RPC_URL = 'mock_url_not_used_by_sdk_mock';

process.env.NODE_ENV = 'test';
process.env.APP_NAME = 'tBTC Relayer Test';
process.env.VERBOSE_APP = 'false'; // Disable verbose logging during tests
process.env.CLEAN_QUEUED_TIME = '1'; // 1 hour for faster testing
process.env.CLEAN_FINALIZED_TIME = '1'; // 1 hour for faster testing
process.env.SUPPORTED_CHAINS = 'mockEVM1,mockEVM2,faultyMockEVM';
process.env.CHAIN_SEPOLIATESTNET_PRIVATE_KEY =
  '0x0000000000000000000000000000000000000000000000000000000000000000';
process.env.CHAIN_SOLANADEVNET_PRIVATE_KEY =
  '0x0000000000000000000000000000000000000000000000000000000000000000';
process.env.CHAIN_STARKNETTESTNET_PRIVATE_KEY =
  '0x0000000000000000000000000000000000000000000000000000000000000000';
process.env.CHAIN_SUITESTNET_PRIVATE_KEY =
  '0x0000000000000000000000000000000000000000000000000000000000000000';
