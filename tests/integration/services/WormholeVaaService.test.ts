// THIS MUST BE AT THE VERY TOP, BEFORE ANY OTHER IMPORTS THAT MIGHT PULL IN 'ethers'
// import { jest } from '@jest/globals';
// import {
//   // mockJsonRpcProviderConstructor_for_tests_setup, // Will define locally now
//   mockGetTransactionReceiptFn_setup,   // Still import these helpers
//   mockGetNetworkFn_setup,
// } from '../../setup.js';

const mockStaticParseVaa = jest.fn(); // Using var and initializing early
const mockSdkDeserialize = jest.fn<typeof SdkDeserializeType>();

// // Define the mock constructor for JsonRpcProvider here, within the scope accessible to doMock
// // It will use the global counter from setup.ts and the helper mock functions from setup.ts
// const mockJsonRpcProviderConstructorForThisTestFile = jest
//   .fn()
//   .mockImplementation((...args: any[]) => {
//     (global as any).CONSTRUCTOR_CALL_COUNT++; // Uses global counter from setup.ts
//     console.log(
//       '[WormholeVaaService.test.ts MOCK JsonRpcProvider] CALLED with:',
//       args.length > 0 ? args[0] : 'no args',
//     );
//     return {
//       getTransactionReceipt: mockGetTransactionReceiptFn_setup, // Uses helper from setup.ts
//       getNetwork: mockGetNetworkFn_setup,                   // Uses helper from setup.ts
//     };
//   });

// jest.doMock('ethers', () => {
//   const originalEthers = jest.requireActual('ethers') as typeof import('ethers');
//   console.log(
//     '[TEST_FILE ethers doMock factory] Mocking ethers.providers.JsonRpcProvider with LOCALLY DEFINED mock',
//   );
//   return {
//     __esModule: true,
//     ...originalEthers,
//     providers: {
//       ...originalEthers.providers,
//       JsonRpcProvider: mockJsonRpcProviderConstructorForThisTestFile, // Use the one defined in this file
//     },
//     _mockJsonRpcProviderConstructor_for_tests: mockJsonRpcProviderConstructorForThisTestFile, // Expose it for assertions
//   };
// });

// Now that 'ethers' is mocked, we can import modules that depend on it.
// process.env.USE_REAL_WORMHOLE_SERVICE = 'true'; // Ensure we test the REAL service

// This line is CRUCIAL to ensure we are testing the actual service implementation
// and not a mock from elsewhere (e.g. if setup.ts were to mock it by default).
jest.dontMock('../../../services/WormholeVaaService');

import { jest } from '@jest/globals';
import { describe, test, expect, beforeEach } from '@jest/globals';
import { WormholeVaaService } from '../../../services/WormholeVaaService.js';

// We will import actual ethers for types, but not rely on its module mocking for JsonRpcProvider
import { type providers as EthersProviders, BigNumber as EthersBigNumber } from 'ethers';

// SDK related imports from @wormhole-foundation/sdk (mocked via setup.ts)
import {
  wormhole,
  // Wormhole, // Not directly used for instance type, class mock is separate
  UniversalAddress as ActualUniversalAddress,
  type Network,
  type ChainId,
  chainIdToChain as actualChainIdToChain,
  type WormholeMessageId,
  type Chain,
  type VAA,
  toChainId,
  type PayloadLiteral,
  type deserialize as SdkDeserializeType,
  type PayloadDiscriminator,
  type DistributiveVAA, // Keep DistributiveVAA if it's a valid export from SDK
  // type ChainContext, // No longer importing for Pick
  // type TokenBridge,  // No longer importing for Pick
} from '@wormhole-foundation/sdk';

import logger, { logErrorContext } from '../../../utils/Logger.js';
import evmPlatform from '@wormhole-foundation/sdk/platforms/evm';
import solanaPlatform from '@wormhole-foundation/sdk/platforms/solana';

// Logger mock
jest.mock('../../../utils/Logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  logErrorContext: jest.fn(),
}));

const mockWormholeEntry = wormhole as jest.MockedFunction<typeof wormhole>;
const mockLogger = logger as jest.Mocked<typeof logger>;
const mockLogErrorContext = logErrorContext as jest.MockedFunction<typeof logErrorContext>;

// Variables for the mock provider INSTANCE
let mockGetTransactionReceiptFn_instance: jest.MockedFunction<
  (txHash: string) => Promise<EthersProviders.TransactionReceipt | null>
>;
let mockGetNetworkFn_instance: jest.MockedFunction<() => Promise<EthersProviders.Network>>;
let mockL2ProviderInstance: EthersProviders.JsonRpcProvider;

const EXPECTED_GET_VAA_TIMEOUT_MS = 300000;

// Module-scoped variables to hold the mock functions of the LATEST JsonRpcProvider instance
// This is a bit of a hack to allow tests to configure the mocks of the internally created provider.
let lastMockedGetTransactionReceipt: jest.Mock<
  (txHash: string) => Promise<EthersProviders.TransactionReceipt | null>
>;
let lastMockedGetNetwork: jest.Mock<() => Promise<EthersProviders.Network>>;
let providerInstanceCount = 0; // For tracking instances

// New top-level mock function for the static method
// const mockStaticParseVaa = jest.fn(); // This line will be removed by the edit

// New mock for the top-level deserialize function

jest.mock('ethers', () => {
  const actualEthersModule = jest.requireActual('ethers') as any;
  // console.log('[INTEGRATION TEST MOCK ethers MODULE LEVEL]');

  // Define a type for our mocked provider instance
  type MockProviderInstance = {
    // Use single generic for the full function signature
    getTransactionReceipt: jest.Mock<
      (txHash: string) => Promise<EthersProviders.TransactionReceipt | null>
    >;
    getNetwork: jest.Mock<() => Promise<EthersProviders.Network>>;
    _isProvider: boolean;
    _isCustomMock: boolean;
    _instanceId: number;
  };

  const MockJsonRpcProvider = jest
    .fn<(url?: string) => MockProviderInstance>()
    .mockImplementation((url?: string): MockProviderInstance => {
      providerInstanceCount++;
      const currentInstanceId = providerInstanceCount;

      // Explicitly type jest.fn() with the full function signature
      const instanceGetTransactionReceipt =
        jest.fn<(txHash: string) => Promise<EthersProviders.TransactionReceipt | null>>();

      // Provide a default successful resolution for getNetwork
      const instanceGetNetwork = jest
        .fn<() => Promise<EthersProviders.Network>>()
        .mockResolvedValue({
          name: 'default-mock-network',
          chainId: 1, // Default to Ethereum mainnet, can be overridden in tests
          // ensAddress: undefined, // Optional: Add if needed by any code path
          // _defaultProvider: undefined, // Optional: Add if needed
        } as EthersProviders.Network);

      lastMockedGetTransactionReceipt = instanceGetTransactionReceipt;
      lastMockedGetNetwork = instanceGetNetwork;

      return {
        getTransactionReceipt: instanceGetTransactionReceipt,
        getNetwork: instanceGetNetwork,
        _isProvider: true,
        _isCustomMock: true,
        _instanceId: currentInstanceId,
      };
    });

  return {
    __esModule: true,
    ...actualEthersModule, // Spread original stuff first
    // Ethers V5 places providers under `ethers.providers` when importing `ethers`
    // and also allows direct import `import { providers } from 'ethers'`
    ethers: {
      ...actualEthersModule.ethers,
      providers: {
        ...actualEthersModule.ethers?.providers,
        JsonRpcProvider: MockJsonRpcProvider,
      },
    },
    // For `import { providers } from 'ethers'`
    providers: {
      ...actualEthersModule.providers,
      JsonRpcProvider: MockJsonRpcProvider,
    },
    // Ensure BigNumber and other utils are still from actualEthers if not overridden
    BigNumber: actualEthersModule.BigNumber,
    utils: actualEthersModule.utils,
    // Contract, Wallet, etc., should also be preserved if used.
    Contract: actualEthersModule.Contract,
    Wallet: actualEthersModule.Wallet,
  };
});

// Define simplified interfaces for our mocked objects
interface MockedTokenBridge {
  // Mocking the method signature: (vaa: VAA<any>) => Promise<boolean>
  isTransferCompleted: jest.Mock<(vaa: VAA<any>) => Promise<boolean>>;
}

interface MockedChainContext {
  // Mocking: (txHash: string) => Promise<WormholeMessageId[]>
  parseTransaction: jest.Mock<(txHash: string) => Promise<WormholeMessageId[]>>;
  // Mocking: () => Promise<MockedTokenBridge>
  getTokenBridge: jest.Mock<() => Promise<MockedTokenBridge>>;
}

interface MockedWormholeSdkInstance {
  // Mocking: (chainOrChainId: Chain | ChainId) => MockedChainContext
  getChain: jest.Mock<(chainOrChainId: Chain | ChainId) => MockedChainContext>;
  // Mocking: <T extends PayloadLiteral>(id: WormholeMessageId, decodeAs: T, timeout?: number) => Promise<VAA<T> | null>
  getVaa: jest.Mock<
    <T extends PayloadLiteral>(
      id: WormholeMessageId,
      decodeAs: T, // Param name changed from payloadDet to match typical SDK usage
      timeout?: number,
    ) => Promise<VAA<T> | null>
  >;
  // Mocking: (id: WormholeMessageId, timeout?: number) => Promise<Uint8Array | null>
  getVaaBytes: jest.Mock<(id: WormholeMessageId, timeout?: number) => Promise<Uint8Array | null>>;
}

jest.mock('@wormhole-foundation/sdk', () => {
  const actualSdk = jest.requireActual('@wormhole-foundation/sdk') as any;

  // const MockWormholeClass = class { /* ... */ }; // Assuming mockStaticParseVaa is handled if needed

  return {
    __esModule: true,
    ...actualSdk,
    wormhole: jest.fn(
      async (_network: Network, _platforms: any[]): Promise<MockedWormholeSdkInstance> => {
        const mockTokenBridgeInstance: MockedTokenBridge = {
          isTransferCompleted: jest
            .fn<(vaa: VAA<any>) => Promise<boolean>>()
            .mockResolvedValue(false),
        };
        const mockChainContextInstance: MockedChainContext = {
          parseTransaction: jest
            .fn<(txHash: string) => Promise<WormholeMessageId[]>>()
            .mockResolvedValue([]),
          getTokenBridge: jest
            .fn<() => Promise<MockedTokenBridge>>()
            .mockResolvedValue(mockTokenBridgeInstance),
        };

        return {
          getChain: jest
            .fn<(chainOrChainId: Chain | ChainId) => MockedChainContext>()
            .mockReturnValue(mockChainContextInstance),
          getVaa: jest
            .fn<
              <T extends PayloadLiteral>(
                id: WormholeMessageId,
                decodeAs: T,
                timeout?: number,
              ) => Promise<VAA<T> | null>
            >()
            .mockResolvedValue(null),
          getVaaBytes: jest
            .fn<(id: WormholeMessageId, timeout?: number) => Promise<Uint8Array | null>>()
            .mockResolvedValue(null),
        } as MockedWormholeSdkInstance;
      },
    ),
    // Wormhole: MockWormholeClass, // Only if static parseVaa is used by SUT
    deserialize: mockSdkDeserialize,
    UniversalAddress: actualSdk.UniversalAddress,
    chainIdToChain: actualSdk.chainIdToChain,
    toChainId: actualSdk.toChainId,
  };
});

describe('WormholeVaaService', () => {
  const L2_RPC_STRING = 'http://localhost:8545'; // For testing the string RPC path
  const TEST_NETWORK: Network = 'Testnet';
  const L2_TX_HASH = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const EMITTER_ADDRESS_STR = '0x000000000000000000000000000000000000dead';

  const ETHEREUM_CHAIN_ID = toChainId('Ethereum');
  const ARBITRUM_CHAIN_ID = toChainId('Arbitrum');
  const SOLANA_CHAIN_ID = toChainId('Solana');
  const POLYGON_CHAIN_ID = toChainId('Polygon');

  const EVM_CHAIN_ID_GOERLI = 5; // Standard EVM chain ID for Goerli testnet

  let mockGetVaaImplementation: jest.MockedFunction<
    <T extends PayloadLiteral>(
      id: WormholeMessageId,
      decodeAs: T,
      timeout?: number,
    ) => Promise<VAA<T> | null>
  >;
  let mockGetVaaBytesImplementation: jest.MockedFunction<
    (id: WormholeMessageId, timeout?: number) => Promise<Uint8Array | null>
  >;
  let mockWormholeInstance: {
    getChain: jest.MockedFunction<(chain: Chain | ChainId) => any>;
    getVaa: jest.MockedFunction<
      <T extends PayloadLiteral>(
        id: WormholeMessageId,
        decodeAs: T,
        timeout?: number,
      ) => Promise<VAA<T> | null>
    >;
    getVaaBytes: jest.MockedFunction<
      (id: WormholeMessageId, timeout?: number) => Promise<Uint8Array | null>
    >;
  };
  let mockChainContext: {
    parseTransaction: jest.MockedFunction<(txHash: string) => Promise<WormholeMessageId[]>>;
    getTokenBridge: jest.MockedFunction<() => Promise<any>>;
  };
  let mockTokenBridgeOperations: {
    isTransferCompleted: jest.MockedFunction<(vaa: VAA<any>) => Promise<boolean>>;
  };

  const createMockReceipt = (status: number, hash: string): EthersProviders.TransactionReceipt =>
    ({
      status,
      transactionHash: hash,
      logs: [],
      blockHash: '0xmockblockhash',
      blockNumber: 123,
      confirmations: 1,
      cumulativeGasUsed: EthersBigNumber.from(100000),
      effectiveGasPrice: EthersBigNumber.from(10e9), // 10 gwei
      from: '0xmockFromAddress',
      gasUsed: EthersBigNumber.from(50000),
      logsBloom: '0x00...0',
      to: '0xmockToAddress',
      transactionIndex: 0,
      type: 0,
      byzantium: true,
      contractAddress: '0xmockContractAddress',
    }) as unknown as EthersProviders.TransactionReceipt;

  const createMockVaa = (
    emitterAddressStr: string,
    emitterChainId: ChainId,
    overrides: Partial<
      VAA<any> & {
        serialize?: jest.Mock;
        bytes?: Uint8Array;
      }
    > = {},
  ): VAA<any> & {
    serialize?: jest.Mock;
    bytes?: Uint8Array;
  } => {
    const mockEmitterUAddress = new ActualUniversalAddress(emitterAddressStr);
    const defaults = {
      emitterChain: actualChainIdToChain(emitterChainId),
      emitterAddress: mockEmitterUAddress,
      sequence: BigInt(1),
      consistencyLevel: 15,
      protocolName: 'TokenBridge' as const,
      payloadName: 'TransferWithPayload' as const,
      payloadLiteral: 'TokenBridge:TransferWithPayload' as const,
      payload: { somePayloadData: 'data' } as any,
      guardianSet: 0,
      timestamp: Math.floor(Date.now() / 1000),
      nonce: 0,
      signatures: [] as any[],
      hash: new Uint8Array(32).fill(1),
      serialize: jest.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
      bytes: new Uint8Array([1, 2, 3, 4, 5]),
    };
    return { ...defaults, ...overrides } as VAA<any> & {
      serialize?: jest.Mock;
      bytes?: Uint8Array;
    };
  };

  let service: WormholeVaaService;

  beforeEach(async () => {
    // console.log('[TEST beforeEach START] Clearing all mocks.');
    jest.clearAllMocks(); // Clears all mocks, including those for ethers provider methods
    providerInstanceCount = 0; // Reset for each test

    // console.log('[TEST beforeEach] lastMockedGetTransactionReceipt BEFORE service create:', lastMockedGetTransactionReceipt);

    // Assign SDK mocks to the module-scoped variables
    mockGetTransactionReceiptFn_instance =
      jest.fn<(txHash: string) => Promise<EthersProviders.TransactionReceipt | null>>();
    mockGetNetworkFn_instance = jest.fn<() => Promise<EthersProviders.Network>>();

    // mockL2ProviderInstance is no longer directly passed to WormholeVaaService.create
    // It was used to mock provider behavior. If tests need to mock what an internal provider does,
    // it would need a different approach (e.g., mocking ethers.providers.JsonRpcProvider constructor behavior)
    // For now, we'll assume tests using L2_RPC_STRING will cover the string input path.
    mockL2ProviderInstance = {
      getTransactionReceipt: mockGetTransactionReceiptFn_instance,
      getNetwork: mockGetNetworkFn_instance,
      _isProvider: true,
    } as unknown as EthersProviders.JsonRpcProvider;

    mockGetTransactionReceiptFn_instance.mockResolvedValue(null);
    mockGetNetworkFn_instance.mockResolvedValue({
      name: 'test-network',
      chainId: ETHEREUM_CHAIN_ID,
    } as EthersProviders.Network);

    mockGetVaaImplementation = jest.fn<
      <T extends PayloadLiteral>(
        id: WormholeMessageId,
        decodeAs: T,
        timeout?: number,
      ) => Promise<VAA<T> | null>
    >() as jest.MockedFunction<
      <T extends PayloadLiteral>(
        id: WormholeMessageId,
        decodeAs: T,
        timeout?: number,
      ) => Promise<VAA<T> | null>
    >;

    // Default to null as most tests expect VAA failures
    mockGetVaaImplementation.mockResolvedValue(null);

    // Setup for getVaaBytes
    mockGetVaaBytesImplementation =
      jest.fn<(id: WormholeMessageId, timeout?: number) => Promise<Uint8Array | null>>();
    mockGetVaaBytesImplementation.mockResolvedValue(
      new Uint8Array([1, 2, 3, 4, 5]), // Default good value
    );

    mockTokenBridgeOperations = {
      isTransferCompleted: jest.fn<(vaa: VAA<any>) => Promise<boolean>>().mockResolvedValue(false),
    };

    mockChainContext = {
      parseTransaction: jest
        .fn<(txHash: string) => Promise<WormholeMessageId[]>>()
        .mockResolvedValue([]),
      getTokenBridge: jest.fn<() => Promise<any>>().mockResolvedValue(mockTokenBridgeOperations),
    };

    mockWormholeInstance = {
      getChain: jest.fn().mockReturnValue(mockChainContext),
      getVaa: mockGetVaaImplementation, // Keep for now, though might be unused by service
      getVaaBytes: mockGetVaaBytesImplementation, // Add the new mock
      __isMockWhInstance: true,
    } as any;
    mockWormholeEntry.mockImplementation(async (...args: any[]) => {
      if (!mockWormholeInstance) {
        return undefined;
      }
      return mockWormholeInstance as any;
    });

    // Adjust the main service instantiation in beforeEach to use L2_RPC_STRING
    // as the .create method now expects a string URL.
    service = await WormholeVaaService.create(L2_RPC_STRING, TEST_NETWORK, [
      evmPlatform,
      solanaPlatform,
    ]);
    // console.log(`[TEST beforeEach] Service created. lastMockedGetTransactionReceipt NOW (inst #${(service as any).l2Provider?._instanceId}):`, lastMockedGetTransactionReceipt);
    // console.log(`[TEST beforeEach] lastMockedGetNetwork NOW (inst #${(service as any).l2Provider?._instanceId}):`, lastMockedGetNetwork);

    // Because the ethers.JsonRpcProvider is mocked to replace its methods
    // with `lastMockedGetTransactionReceipt` and `lastMockedGetNetwork` upon instantiation,
    // we need to ensure these are reset and have default behaviors FOR EACH TEST.
    // The WormholeVaaService.create() above has triggered the JsonRpcProvider constructor,
    // so lastMocked... should now point to the mocks of the service's internal provider.

    if (lastMockedGetTransactionReceipt) {
      // console.log('[TEST beforeEach] Configuring DEFAULT for lastMockedGetTransactionReceipt - .mockResolvedValue(null)');
      lastMockedGetTransactionReceipt.mockReset().mockResolvedValue(null); // Default: no receipt
    } else {
      // console.log('[TEST beforeEach WARNING] lastMockedGetTransactionReceipt is UNDEFINED after service create!');
    }
    if (lastMockedGetNetwork) {
      // console.log('[TEST beforeEach] Configuring DEFAULT for lastMockedGetNetwork');
      lastMockedGetNetwork.mockReset().mockResolvedValue({
        name: 'mock-integration-network',
        chainId: EVM_CHAIN_ID_GOERLI, // Use EVM chain ID for Ethereum Testnet (Goerli)
      } as EthersProviders.Network);
    } else {
      // console.log('[TEST beforeEach WARNING] lastMockedGetNetwork is UNDEFINED after service create!');
    }

    // Setup common mock VAA data
    const mockReceipt = createMockReceipt(1, L2_TX_HASH);
    if (lastMockedGetTransactionReceipt) {
      lastMockedGetTransactionReceipt.mockResolvedValue(mockReceipt);
    }
    const mockEmitterUAddress = new ActualUniversalAddress(EMITTER_ADDRESS_STR);
    const mockWormholeMessageId: WormholeMessageId = {
      chain: actualChainIdToChain(ETHEREUM_CHAIN_ID),
      emitter: mockEmitterUAddress,
      sequence: BigInt(1),
    };
    mockChainContext.parseTransaction.mockResolvedValue([mockWormholeMessageId]);
    mockTokenBridgeOperations.isTransferCompleted.mockResolvedValue(true);
    const mockVaaBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const mockParsedVaaWithBytes = createMockVaa(EMITTER_ADDRESS_STR, ETHEREUM_CHAIN_ID, {
      bytes: mockVaaBytes,
    });
    mockGetVaaBytesImplementation.mockResolvedValue(mockVaaBytes);
    mockStaticParseVaa.mockReturnValue(mockParsedVaaWithBytes);

    // Default mock implementation for mockSdkDeserialize for each test.
    // Tests that expect successful deserialization will need to override this locally.
    mockSdkDeserialize.mockImplementation((discriminator: any, bytes: any): any => {
      // Default behavior: throw, forcing tests to be specific.
      console.warn(
        `[INTEGRATION TEST DEBUG Default mockSdkDeserialize] Unhandled call. Discriminator: ${discriminator}, Bytes length: ${bytes?.length}. This call was not overridden by a test-specific mock.`,
      );
      throw new Error(
        `mockSdkDeserialize: DEFAULT Unhandled call for discriminator '${discriminator}'. Please mock specific behavior if deserialization is expected in this test.`,
      );
    });
  });

  describe('create', () => {
    test('should successfully create an instance with an RPC string and initialize Wormhole SDK', async () => {
      // This test now reflects the primary way of creating the service.
      // The beforeEach block already creates 'service' using L2_RPC_STRING.
      expect(service).toBeInstanceOf(WormholeVaaService);
      expect(mockWormholeEntry).toHaveBeenCalledWith(TEST_NETWORK, [
        expect.anything(),
        expect.anything(),
      ]);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('WormholeVaaService created'),
      );
      // Verify it logs the RPC string used.
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining(`L2 Provider: ${L2_RPC_STRING}`),
      );
    });

    // The following test becomes somewhat redundant with the above, but we keep it
    // to explicitly show creation with L2_RPC_STRING if beforeEach were different.
    test('should successfully create an instance with an RPC string (explicit test)', async () => {
      const serviceWithString = await WormholeVaaService.create(L2_RPC_STRING, 'Testnet');
      expect(serviceWithString).toBeInstanceOf(WormholeVaaService);
      expect(mockWormholeEntry).toHaveBeenCalledWith('Testnet', [
        expect.anything(),
        expect.anything(),
      ]);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining(`L2 Provider: ${L2_RPC_STRING}`),
      );
    });

    test('should throw an error if wormhole SDK initialization fails (returns null), when created with RPC string', async () => {
      mockWormholeEntry.mockResolvedValue(null as any);
      await expect(WormholeVaaService.create(L2_RPC_STRING)).rejects.toThrow(
        '[WormholeVaaService.create] wormhole SDK initialization failed: wormhole() returned null or undefined.',
      );
    });

    test('should throw an error if wormhole SDK initialization fails (throws error), when created with RPC string', async () => {
      const sdkInitError = new Error('Wormhole SDK init failed for some reason');
      mockWormholeEntry.mockRejectedValue(sdkInitError);
      await expect(WormholeVaaService.create(L2_RPC_STRING)).rejects.toThrow(sdkInitError);
    });
  });

  describe('fetchAndVerifyVaaForL2Event', () => {
    const l2ChainNameForTests: Chain = 'Ethereum';
    const targetL1ChainForTests: Chain = 'Arbitrum';
    const l2ChainIdForTests = toChainId(l2ChainNameForTests);
    const targetL1ChainIdForTests = toChainId(targetL1ChainForTests);

    beforeEach(async () => {
      jest.clearAllMocks();
      providerInstanceCount = 0;

      service = await WormholeVaaService.create(L2_RPC_STRING, TEST_NETWORK, [
        evmPlatform,
        solanaPlatform,
      ]);

      if (lastMockedGetTransactionReceipt) {
        lastMockedGetTransactionReceipt
          .mockReset()
          .mockResolvedValue(null as EthersProviders.TransactionReceipt | null);
      }
      if (lastMockedGetNetwork) {
        lastMockedGetNetwork.mockReset().mockResolvedValue({
          name: 'mock-integration-network',
          chainId: EVM_CHAIN_ID_GOERLI, // Use EVM chain ID for Ethereum Testnet (Goerli)
        } as EthersProviders.Network);
      }

      // Setup common mock VAA data for many tests, can be overridden locally
      const mockReceipt = createMockReceipt(1, L2_TX_HASH);
      if (lastMockedGetTransactionReceipt) {
        lastMockedGetTransactionReceipt.mockResolvedValue(mockReceipt);
      }
      const mockEmitterUAddress = new ActualUniversalAddress(EMITTER_ADDRESS_STR);
      const mockWormholeMessageId: WormholeMessageId = {
        chain: actualChainIdToChain(ETHEREUM_CHAIN_ID),
        emitter: mockEmitterUAddress,
        sequence: BigInt(1),
      };
      mockChainContext.parseTransaction.mockResolvedValue([mockWormholeMessageId]);
      mockTokenBridgeOperations.isTransferCompleted.mockResolvedValue(true);
      const mockVaaBytes = new Uint8Array([1, 2, 3, 4, 5]);
      const mockParsedVaaWithBytes = createMockVaa(EMITTER_ADDRESS_STR, ETHEREUM_CHAIN_ID, {
        bytes: mockVaaBytes,
      });
      mockGetVaaBytesImplementation.mockResolvedValue(mockVaaBytes);
      mockStaticParseVaa.mockReturnValue(mockParsedVaaWithBytes);
    });

    describe('Successful VAA Fetch and Verification', () => {
      test('should successfully fetch, parse, verify, and return VAA', async () => {
        const mockReceipt = createMockReceipt(1, L2_TX_HASH);
        lastMockedGetTransactionReceipt.mockResolvedValue(mockReceipt);

        lastMockedGetNetwork.mockResolvedValue({
          name: 'test-network-success',
          chainId: l2ChainIdForTests,
        } as EthersProviders.Network);

        const mockEmitterUAddress = new ActualUniversalAddress(EMITTER_ADDRESS_STR);
        const mockWormholeMessageId: WormholeMessageId = {
          chain: actualChainIdToChain(ETHEREUM_CHAIN_ID),
          emitter: mockEmitterUAddress,
          sequence: BigInt(1),
        };
        mockChainContext.parseTransaction.mockResolvedValue([mockWormholeMessageId]);
        const mockVaaBytes = new Uint8Array([1, 2, 3, 4, 5]);
        const mockParsedVaaWithBytes = createMockVaa(EMITTER_ADDRESS_STR, ETHEREUM_CHAIN_ID, {
          bytes: mockVaaBytes,
        });
        // Set up getVaa to return the parsed VAA directly
        mockGetVaaImplementation.mockResolvedValue(mockParsedVaaWithBytes);
        mockTokenBridgeOperations.isTransferCompleted.mockResolvedValue(true);

        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          l2ChainIdForTests,
          EMITTER_ADDRESS_STR,
          targetL1ChainIdForTests,
        );
        expect(result).not.toBeNull();
        expect(result?.vaaBytes).toBe(mockVaaBytes);
        expect(result?.parsedVaa).toBe(mockParsedVaaWithBytes);

        expect(lastMockedGetTransactionReceipt).toHaveBeenCalledWith(L2_TX_HASH);
        expect(mockChainContext.parseTransaction).toHaveBeenCalledWith(L2_TX_HASH);
      });

      test('should successfully fetch VAA when VAA has .serialize()', async () => {
        const mockReceipt = createMockReceipt(1, L2_TX_HASH);
        lastMockedGetTransactionReceipt.mockResolvedValue(mockReceipt);

        lastMockedGetNetwork.mockResolvedValue({
          name: 'test-network-serialize',
          chainId: l2ChainIdForTests,
        } as EthersProviders.Network);

        const mockEmitterUAddress = new ActualUniversalAddress(EMITTER_ADDRESS_STR);
        const mockWormholeMessageId: WormholeMessageId = {
          chain: actualChainIdToChain(ETHEREUM_CHAIN_ID),
          emitter: mockEmitterUAddress,
          sequence: BigInt(1),
        };
        mockChainContext.parseTransaction.mockResolvedValue([mockWormholeMessageId]);
        mockTokenBridgeOperations.isTransferCompleted.mockResolvedValue(true);
        const mockVaaBytesSerialized = new Uint8Array([5, 4, 3, 2, 1]);
        const mockParsedVaaNoBytes = createMockVaa(EMITTER_ADDRESS_STR, ETHEREUM_CHAIN_ID, {
          payloadName: 'Transfer',
          payloadLiteral: 'TokenBridge:Transfer',
          payload: { basicTransfer: 'info' } as any,
          hash: new Uint8Array(32).fill(2),
          serialize: jest.fn<() => Uint8Array>().mockReturnValue(mockVaaBytesSerialized),
          bytes: undefined,
        }) as VAA<'TokenBridge:Transfer'> & { serialize: jest.Mock<() => Uint8Array> };

        // Set up getVaa to return the parsed VAA directly
        mockGetVaaImplementation.mockResolvedValue(mockParsedVaaNoBytes);

        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          l2ChainIdForTests,
          EMITTER_ADDRESS_STR,
          targetL1ChainIdForTests,
        );
        expect(result).not.toBeNull();
        expect(result?.vaaBytes).toEqual(mockVaaBytesSerialized);

        expect(lastMockedGetTransactionReceipt).toHaveBeenCalledWith(L2_TX_HASH);
        expect(mockChainContext.parseTransaction).toHaveBeenCalledWith(L2_TX_HASH);
        expect(mockParsedVaaNoBytes.serialize).toHaveBeenCalled();
      });
    });

    describe('L2 Transaction Receipt Failures', () => {
      test('should return null if L2 transaction receipt cannot be fetched (provider throws)', async () => {
        if (!lastMockedGetTransactionReceipt) {
          // This is a diagnostic check
          throw new Error(
            "TEST ERROR: lastMockedGetTransactionReceipt is undefined before .mockRejectedValue call in 'provider throws' test.",
          );
        }
        lastMockedGetTransactionReceipt.mockRejectedValue(new Error('Provider unavailable'));
        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          l2ChainIdForTests,
          EMITTER_ADDRESS_STR,
          targetL1ChainIdForTests,
        );
        expect(result).toBeNull();
        expect(lastMockedGetTransactionReceipt).toHaveBeenCalledWith(L2_TX_HASH);
        expect(mockLogErrorContext).toHaveBeenCalledWith(
          `Failed to get L2 transaction receipt for ${L2_TX_HASH}. Original error: Provider unavailable`,
          expect.any(Error), // The service logs the original error caught
        );
      });

      test('should return null if L2 transaction receipt is null', async () => {
        lastMockedGetTransactionReceipt.mockResolvedValue(
          null as EthersProviders.TransactionReceipt | null,
        );
        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          l2ChainIdForTests,
          EMITTER_ADDRESS_STR,
          targetL1ChainIdForTests,
        );
        expect(result).toBeNull();
        expect(lastMockedGetTransactionReceipt).toHaveBeenCalledWith(L2_TX_HASH);
        expect(mockLogErrorContext).toHaveBeenCalledWith(
          expect.stringContaining(
            `Failed to get L2 transaction receipt for ${L2_TX_HASH} on ${actualChainIdToChain(l2ChainIdForTests)}. Receipt is null.`,
          ),
          expect.objectContaining({ message: 'L2 transaction receipt is null' }),
        );
      });

      test('should return null if L2 transaction failed (status 0)', async () => {
        const mockReceipt = createMockReceipt(0, L2_TX_HASH);
        lastMockedGetTransactionReceipt.mockResolvedValue(
          mockReceipt as EthersProviders.TransactionReceipt,
        );
        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          l2ChainIdForTests,
          EMITTER_ADDRESS_STR,
          targetL1ChainIdForTests,
        );
        expect(result).toBeNull();
        expect(lastMockedGetTransactionReceipt).toHaveBeenCalledWith(L2_TX_HASH);
        expect(mockLogErrorContext).toHaveBeenCalledWith(
          expect.stringContaining(
            `L2 transaction ${L2_TX_HASH} failed (reverted), cannot fetch VAA. Receipt:`,
          ),
          expect.objectContaining({ message: 'L2 transaction failed' }),
        );
      });
    });

    describe('wormhole message parsing', () => {
      test('Test 2.3.1: Should return null if parseTransaction returns no Wormhole messages', async () => {
        const mockReceipt = createMockReceipt(1, L2_TX_HASH);
        lastMockedGetTransactionReceipt.mockResolvedValue(
          mockReceipt as EthersProviders.TransactionReceipt,
        );
        mockChainContext.parseTransaction.mockResolvedValue([]); // No messages

        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          l2ChainIdForTests,
          EMITTER_ADDRESS_STR,
          targetL1ChainIdForTests,
        );
        expect(result).toBeNull();
        expect(lastMockedGetTransactionReceipt).toHaveBeenCalledWith(L2_TX_HASH);
        expect(mockChainContext.parseTransaction).toHaveBeenCalledWith(L2_TX_HASH);
        expect(mockLogErrorContext).toHaveBeenCalledWith(
          expect.stringContaining(
            `No Wormhole messages found in L2 transaction ${L2_TX_HASH}. Chain: ${actualChainIdToChain(l2ChainIdForTests)}.`,
          ),
          expect.objectContaining({ message: 'No Wormhole messages found in L2 transaction' }),
        );
      });

      test('should return null if no WormholeMessageId matches the emitter address and chain', async () => {
        const nonMatchingEmitterAddressStr = '0x1111111111111111111111111111111111111111';
        const mockWormholeMessageIdNonMatchingEmitter: WormholeMessageId = {
          chain: actualChainIdToChain(ETHEREUM_CHAIN_ID),
          emitter: new ActualUniversalAddress(nonMatchingEmitterAddressStr),
          sequence: BigInt(1),
        };
        const mockWormholeMessageIdNonMatchingChain: WormholeMessageId = {
          chain: actualChainIdToChain(POLYGON_CHAIN_ID),
          emitter: new ActualUniversalAddress(EMITTER_ADDRESS_STR),
          sequence: BigInt(2),
        };
        mockChainContext.parseTransaction.mockResolvedValue([
          mockWormholeMessageIdNonMatchingEmitter,
          mockWormholeMessageIdNonMatchingChain,
        ]);
        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          ETHEREUM_CHAIN_ID,
          EMITTER_ADDRESS_STR,
          ARBITRUM_CHAIN_ID,
        );
        expect(result).toBeNull();
        expect(mockLogErrorContext).toHaveBeenCalledWith(
          expect.stringContaining(
            `Could not find relevant Wormhole message from emitter ${new ActualUniversalAddress(EMITTER_ADDRESS_STR).toString()} (derived from native ${EMITTER_ADDRESS_STR}) on chain ${actualChainIdToChain(ETHEREUM_CHAIN_ID)} in L2 transaction ${L2_TX_HASH}. All found messages:`,
          ),
          expect.objectContaining({ message: 'Relevant Wormhole message not found' }),
        );
      });
    });

    describe('getVaa() issues', () => {
      let mockWormholeMessageId: WormholeMessageId;
      beforeEach(() => {
        const mockReceipt = createMockReceipt(1, L2_TX_HASH);
        lastMockedGetTransactionReceipt.mockResolvedValue(mockReceipt);
        mockWormholeMessageId = {
          chain: actualChainIdToChain(ETHEREUM_CHAIN_ID),
          emitter: new ActualUniversalAddress(EMITTER_ADDRESS_STR),
          sequence: BigInt(1),
        };
        mockChainContext.parseTransaction.mockResolvedValue([mockWormholeMessageId]);
        mockTokenBridgeOperations.isTransferCompleted.mockResolvedValue(true);
      });

      test('should return null if this.wh.getVaa() throws an error', async () => {
        const getVaaError = new Error('Failed to fetch VAA from API');
        mockGetVaaImplementation.mockRejectedValue(getVaaError);
        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          ETHEREUM_CHAIN_ID,
          EMITTER_ADDRESS_STR,
          ARBITRUM_CHAIN_ID,
        );
        expect(result).toBeNull();
        expect(mockGetVaaImplementation).toHaveBeenCalledWith(
          mockWormholeMessageId,
          expect.any(String), // discriminator
          300000, // timeout
        );
        expect(mockLogErrorContext).toHaveBeenLastCalledWith(
          expect.stringContaining(
            `Error fetching VAA for L2 transaction ${L2_TX_HASH}, emitter ${EMITTER_ADDRESS_STR}, sequence ${mockWormholeMessageId.sequence}: ${getVaaError.message}`,
          ),
          getVaaError, // The service logs the original error
        );
      });

      test('Test 2.4.2: Should return null if this.wh.getVaa() returns null', async () => {
        mockGetVaaImplementation.mockResolvedValue(null);
        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          ETHEREUM_CHAIN_ID,
          EMITTER_ADDRESS_STR,
          ARBITRUM_CHAIN_ID,
        );
        expect(result).toBeNull();
        expect(mockGetVaaImplementation).toHaveBeenCalledWith(
          mockWormholeMessageId,
          expect.any(String), // discriminator
          300000, // timeout
        );
        expect(mockLogErrorContext).toHaveBeenLastCalledWith(
          expect.stringContaining(`this.wh.getVaa did not return a VAA for message ID`),
          expect.objectContaining({ message: 'Failed to get VAA bytes (returned null)' }),
        );
      });
    });

    describe('initial VAA verification failures', () => {
      let mockBaseVaa: VAA<'TokenBridge:TransferWithPayload'> & {
        serialize: jest.Mock<() => Uint8Array>;
      };

      beforeEach(() => {
        const mockReceipt = createMockReceipt(1, L2_TX_HASH);
        lastMockedGetTransactionReceipt.mockResolvedValue(mockReceipt);
        const mockWormholeMessageId: WormholeMessageId = {
          chain: actualChainIdToChain(ETHEREUM_CHAIN_ID),
          emitter: new ActualUniversalAddress(EMITTER_ADDRESS_STR),
          sequence: BigInt(1),
        };
        mockChainContext.parseTransaction.mockResolvedValue([mockWormholeMessageId]);
        mockTokenBridgeOperations.isTransferCompleted.mockResolvedValue(true);
        mockBaseVaa = createMockVaa(EMITTER_ADDRESS_STR, ETHEREUM_CHAIN_ID, {
          guardianSet: 0,
          payloadName: 'TokenBridge:TransferWithPayload',
          payloadLiteral: 'TokenBridge:TransferWithPayload',
        }) as VAA<'TokenBridge:TransferWithPayload'> & {
          serialize: jest.Mock<() => Uint8Array>;
          bytes?: Uint8Array;
        };

        const serializedBytesForBaseVaa = mockBaseVaa.serialize!();
        mockGetVaaBytesImplementation.mockResolvedValue(serializedBytesForBaseVaa);
        mockStaticParseVaa.mockReturnValue(mockBaseVaa); // When these bytes are parsed, return mockBaseVaa
      });

      test('should return null if VAA emitterChain mismatch', async () => {
        const mismatchedParsedVaa = createMockVaa(EMITTER_ADDRESS_STR, ETHEREUM_CHAIN_ID, {
          emitterChain: actualChainIdToChain(SOLANA_CHAIN_ID),
          guardianSet: 0, // ensure valid for parsing step
        });
        // Mock getVaa to return the mismatched VAA
        mockGetVaaImplementation.mockResolvedValue(mismatchedParsedVaa);

        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          ETHEREUM_CHAIN_ID,
          EMITTER_ADDRESS_STR,
          ARBITRUM_CHAIN_ID,
        );
        expect(result).toBeNull();
        expect(mockLogErrorContext).toHaveBeenCalledWith(
          expect.stringContaining('VAA verification failed: Emitter chain mismatch'),
          expect.objectContaining({ message: 'VAA emitter chain mismatch' }),
        );
      });

      test('should return null if VAA emitterAddress mismatch', async () => {
        const wrongEmitterAddressStr = '0xbad0000000000000000000000000000000000bad';
        const mismatchedEmitterAddressVaa = createMockVaa(EMITTER_ADDRESS_STR, ETHEREUM_CHAIN_ID, {
          emitterAddress: new ActualUniversalAddress(wrongEmitterAddressStr),
          guardianSet: 0, // ensure valid for parsing step
        });
        // Mock getVaa to return the mismatched VAA
        mockGetVaaImplementation.mockResolvedValue(mismatchedEmitterAddressVaa);

        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          ETHEREUM_CHAIN_ID,
          EMITTER_ADDRESS_STR,
          ARBITRUM_CHAIN_ID,
        );
        expect(result).toBeNull();
        expect(mockLogErrorContext).toHaveBeenCalledWith(
          expect.stringContaining('VAA verification failed: Emitter address mismatch'),
          expect.objectContaining({ message: 'VAA emitter address mismatch' }),
        );
      });

      test('low consistency level should log warning but pass verification if other checks are ok', async () => {
        const MIN_VAA_CONSISTENCY_LEVEL_IN_SERVICE = 1;
        const lowConsistencyVaa = createMockVaa(EMITTER_ADDRESS_STR, ETHEREUM_CHAIN_ID, {
          consistencyLevel: 0.5, // Below minimum but not 0, should trigger warning
          guardianSet: 0, // ensure valid for parsing step
        });
        // Mock getVaa to return the low consistency VAA
        mockGetVaaImplementation.mockResolvedValue(lowConsistencyVaa);
        mockTokenBridgeOperations.isTransferCompleted.mockResolvedValue(true);

        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          ETHEREUM_CHAIN_ID,
          EMITTER_ADDRESS_STR,
          ARBITRUM_CHAIN_ID,
        );
        expect(result).not.toBeNull();
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(
            `VAA verification warning: Low consistency level. Expected ${MIN_VAA_CONSISTENCY_LEVEL_IN_SERVICE}, Got: 0.5`,
          ),
        );
        expect(mockLogErrorContext).not.toHaveBeenCalledWith(
          expect.stringContaining('Initial VAA verification (emitter check) failed'),
          expect.anything(),
        );
      });

      test('VAA with consistency level 0 should pass verification and not log MIN_VAA_CONSISTENCY_LEVEL warning', async () => {
        const mockVaaWithCLZero = createMockVaa(EMITTER_ADDRESS_STR, ETHEREUM_CHAIN_ID, {
          consistencyLevel: 0,
          guardianSet: 0, // ensure valid for parsing step
        });
        // Mock getVaa to return the VAA with consistency level 0
        mockGetVaaImplementation.mockResolvedValue(mockVaaWithCLZero);
        mockTokenBridgeOperations.isTransferCompleted.mockResolvedValue(true);

        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          ETHEREUM_CHAIN_ID,
          EMITTER_ADDRESS_STR,
          ARBITRUM_CHAIN_ID,
        );
        expect(result).not.toBeNull();
        const warnCalls = mockLogger.warn.mock.calls;
        const consistencyWarningPatternCL1 =
          /VAA verification warning: Low consistency level. Expected 1, Got: 1/;
        for (const call of warnCalls) {
          expect(call[0]).not.toMatch(consistencyWarningPatternCL1);
        }
        expect(mockLogErrorContext).not.toHaveBeenCalledWith(
          expect.stringContaining('Initial VAA verification (emitter check) failed'),
          expect.anything(),
        );
      });
    });

    describe('VAA content verification failures', () => {
      let mockWormholeMessageId: WormholeMessageId;
      beforeEach(() => {
        const mockReceipt = createMockReceipt(1, L2_TX_HASH);
        lastMockedGetTransactionReceipt.mockResolvedValue(mockReceipt);
        mockWormholeMessageId = {
          chain: actualChainIdToChain(ETHEREUM_CHAIN_ID),
          emitter: new ActualUniversalAddress(EMITTER_ADDRESS_STR),
          sequence: BigInt(1),
        };
        mockChainContext.parseTransaction.mockResolvedValue([mockWormholeMessageId]);
        mockTokenBridgeOperations.isTransferCompleted.mockResolvedValue(true);
      });

      test('Should return null if VAA protocolName is not TokenBridge', async () => {
        const vaaWithWrongProtocol = createMockVaa(EMITTER_ADDRESS_STR, ETHEREUM_CHAIN_ID, {
          protocolName: 'AnotherProtocol' as any,
          guardianSet: 0, // ensure valid for parsing step
        });
        // Set up the getVaa mock to return the VAA with wrong protocol name
        mockGetVaaImplementation.mockResolvedValue(vaaWithWrongProtocol);

        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          ETHEREUM_CHAIN_ID,
          EMITTER_ADDRESS_STR,
          ARBITRUM_CHAIN_ID,
        );
        expect(result).toBeNull();
        expect(mockLogErrorContext).toHaveBeenCalledWith(
          expect.stringContaining('VAA verification failed: Protocol name mismatch'),
          expect.objectContaining({ message: 'VAA protocol name mismatch' }),
        );
      });

      test('should return null if VAA payloadName is not Transfer or TransferWithPayload', async () => {
        const vaaWithWrongPayloadName = createMockVaa(EMITTER_ADDRESS_STR, ETHEREUM_CHAIN_ID, {
          payloadName: 'SomeOtherPayload' as any,
          payloadLiteral: 'TokenBridge:SomeOtherPayload' as any,
          guardianSet: 0, // ensure valid for parsing step
        });
        // Set up the getVaa mock to return the VAA with wrong payload name
        mockGetVaaImplementation.mockResolvedValue(vaaWithWrongPayloadName);

        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          ETHEREUM_CHAIN_ID,
          EMITTER_ADDRESS_STR,
          ARBITRUM_CHAIN_ID,
        );
        expect(result).toBeNull();
        expect(mockLogErrorContext).toHaveBeenCalledWith(
          `[WormholeVaaService] Payload name mismatch. Expected: TokenBridge:Transfer or TokenBridge:TransferWithPayload, Got: ${vaaWithWrongPayloadName.payloadLiteral}.`,
          expect.objectContaining({ message: 'VAA payload name mismatch' }),
        );
      });
    });

    describe('transfer completion issues', () => {
      const getTokenBridgeError = new Error('Failed to get L1 Token Bridge');
      const isTransferCompletedError = new Error('isTransferCompleted exploded');
      const testCases = [
        {
          description:
            'should return null if tokenBridge.isTransferCompleted() returns false on L1',
          setupL1Mocks: (
            _l1ChainCtx: typeof mockChainContext,
            l1TokenBridgeOps: typeof mockTokenBridgeOperations,
          ) => {
            l1TokenBridgeOps.isTransferCompleted.mockResolvedValue(false);
          },
          expectedLogMessage: 'Token bridge transfer VAA not completed on L1',
          expectedErrorObject: expect.objectContaining({
            message: 'VAA transfer not completed on L1',
          }),
        },
        {
          description: 'should return null if l1ChainContext.getTokenBridge() throws an error',
          setupL1Mocks: (
            l1ChainCtx: typeof mockChainContext,
            _l1TokenBridgeOps: typeof mockTokenBridgeOperations,
          ) => {
            l1ChainCtx.getTokenBridge.mockRejectedValue(getTokenBridgeError);
          },
          expectedLogMessage: 'Error checking VAA completion on L1',
          expectedErrorObject: getTokenBridgeError,
        },
        {
          description: 'should return null if L1 tokenBridge.isTransferCompleted() throws an error',
          setupL1Mocks: (
            _l1ChainCtx: typeof mockChainContext,
            l1TokenBridgeOps: typeof mockTokenBridgeOperations,
          ) => {
            l1TokenBridgeOps.isTransferCompleted.mockRejectedValue(isTransferCompletedError);
          },
          expectedLogMessage: 'Error checking VAA completion on L1',
          expectedErrorObject: isTransferCompletedError,
        },
      ];

      test.each(testCases)(
        '$description',
        async ({ setupL1Mocks, expectedLogMessage, expectedErrorObject }) => {
          const mockReceipt = createMockReceipt(1, L2_TX_HASH);
          lastMockedGetTransactionReceipt.mockResolvedValue(mockReceipt);
          const mockEmitterUAddress = new ActualUniversalAddress(EMITTER_ADDRESS_STR);
          const mockWormholeMessageId: WormholeMessageId = {
            chain: actualChainIdToChain(ETHEREUM_CHAIN_ID),
            emitter: mockEmitterUAddress,
            sequence: BigInt(1),
          };
          mockChainContext.parseTransaction.mockResolvedValue([mockWormholeMessageId]);

          const baseVaa = createMockVaa(EMITTER_ADDRESS_STR, ETHEREUM_CHAIN_ID, {
            guardianSet: 0,
            payloadName: 'TokenBridge:TransferWithPayload',
            payloadLiteral: 'TokenBridge:TransferWithPayload',
          }) as VAA<'TokenBridge:TransferWithPayload'> & {
            serialize: jest.Mock<() => Uint8Array>;
            bytes?: Uint8Array;
          };

          // CRITICAL FIX: Mock getVaa to return the baseVaa so service can proceed to L1 transfer completion logic
          mockGetVaaImplementation.mockResolvedValue(baseVaa);

          const l1TokenBridgeOperationsMock: typeof mockTokenBridgeOperations = {
            isTransferCompleted: jest
              .fn<(vaa: VAA<any>) => Promise<boolean>>()
              .mockResolvedValue(true), // Default to true, individual tests will override
          };
          const l1ChainContextMock: typeof mockChainContext = {
            parseTransaction: jest
              .fn<(txHash: string) => Promise<WormholeMessageId[]>>()
              .mockResolvedValue([]),
            getTokenBridge: jest
              .fn<() => Promise<any>>()
              .mockResolvedValue(l1TokenBridgeOperationsMock), // Default to successful bridge
          };

          // Apply the specific test case setup BEFORE setting up the chain mock
          setupL1Mocks(l1ChainContextMock, l1TokenBridgeOperationsMock);

          // Set up the wormhole instance getChain mock to return appropriate contexts
          mockWormholeInstance.getChain.mockImplementation((chainOrChainId) => {
            const targetChain =
              typeof chainOrChainId === 'string'
                ? chainOrChainId
                : actualChainIdToChain(chainOrChainId);
            if (targetChain === actualChainIdToChain(ETHEREUM_CHAIN_ID)) {
              return mockChainContext;
            }
            if (targetChain === actualChainIdToChain(ARBITRUM_CHAIN_ID)) {
              return l1ChainContextMock;
            }
            throw new Error(`Unexpected chain in getChain mock: ${chainOrChainId}`);
          });

          const result = await service.fetchAndVerifyVaaForL2Event(
            L2_TX_HASH,
            ETHEREUM_CHAIN_ID,
            EMITTER_ADDRESS_STR,
            ARBITRUM_CHAIN_ID,
          );

          expect(result).toBeNull();
          expect(mockLogErrorContext).toHaveBeenCalledWith(
            expect.stringContaining(expectedLogMessage),
            expectedErrorObject,
          );
          if (expectedLogMessage.includes('Token bridge transfer VAA not completed on L1')) {
            expect(l1TokenBridgeOperationsMock.isTransferCompleted).toHaveBeenCalledWith(baseVaa);
          }
        },
      );
    });
  });
});
