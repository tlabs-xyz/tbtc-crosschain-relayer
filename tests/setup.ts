import { jest } from '@jest/globals';

process.env.SUPPORTED_CHAINS = 'MockEVM1,MockEVM2,FaultyMockEVM,MockEndpointChain';
process.env.CHAIN_SEPOLIATESTNET_PRIVATE_KEY =
  '0x0000000000000000000000000000000000000000000000000000000000000000';
process.env.CHAIN_SUITESTNET_PRIVATE_KEY =
  '0x0000000000000000000000000000000000000000000000000000000000000000';
process.env.CHAIN_SOLANADEVNET_PRIVATE_KEY =
  '0x0000000000000000000000000000000000000000000000000000000000000000';
process.env.CHAIN_STARKNETTESTNET_PRIVATE_KEY =
  '0x0000000000000000000000000000000000000000000000000000000000000000';
process.env.CHAIN_STARKNETTESTNET_DEPLOYER_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
process.env.LOG_LEVEL = 'debug';
process.env.NODE_ENV = 'test';
process.env.APP_NAME = 'TBTC RELAYER TEST';
process.env.VERBOSE_APP = 'false'; // Disable verbose logging during tests

// --- Global SDK Mock ---
const actualSdk = jest.requireActual('@wormhole-foundation/sdk') as any;
jest.mock('@wormhole-foundation/sdk', () => {
  return {
    __esModule: true,
    ...actualSdk,
    wormhole: jest.fn(),
    chainIdToChain: jest.fn((...args) => actualSdk.chainIdToChain(...args)),
  };
});
