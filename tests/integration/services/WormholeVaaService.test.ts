/* eslint-disable @typescript-eslint/no-explicit-any */

const mockStaticParseVaa = jest.fn();
const mockSdkDeserialize = jest.fn<typeof SdkDeserializeType>();

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

// Module-scoped variables to hold the mock functions of the LATEST JsonRpcProvider instance
let lastMockedGetTransactionReceipt:
  | jest.Mock<(txHash: string) => Promise<EthersProviders.TransactionReceipt | null>>
  | undefined;
let lastMockedGetNetwork: jest.Mock<() => Promise<EthersProviders.Network>> | undefined;

jest.mock('ethers', () => {
  const actualEthersModule = jest.requireActual('ethers') as Record<string, unknown>;

  class MockedJsonRpcProvider {
    public getTransactionReceipt: jest.Mock<
      (txHash: string) => Promise<EthersProviders.TransactionReceipt | null>
    >;
    public getNetwork: jest.Mock<() => Promise<EthersProviders.Network>>;

    constructor(..._args: unknown[]) {
      this.getTransactionReceipt = jest.fn();
      this.getNetwork = jest.fn();

      // Store the reference to the mocked methods so tests can access them
      lastMockedGetTransactionReceipt = this.getTransactionReceipt;
      lastMockedGetNetwork = this.getNetwork;
    }
  }

  return {
    ...actualEthersModule,
    // The main ethers export with providers property for ethers.providers.JsonRpcProvider usage
    ethers: {
      providers: {
        JsonRpcProvider: MockedJsonRpcProvider,
      },
      BigNumber: actualEthersModule.BigNumber,
    },
    // Also export providers directly for any direct imports
    providers: {
      JsonRpcProvider: MockedJsonRpcProvider,
    },
    // Keep other exports
    BigNumber: actualEthersModule.BigNumber,
  };
});

interface MockedTokenBridge {
  isTransferCompleted: jest.Mock<(vaa: VAA<PayloadLiteral>) => Promise<boolean>>;
}

interface MockedChainContext {
  parseTransaction: jest.Mock<(txHash: string) => Promise<WormholeMessageId[]>>;
  getTokenBridge: jest.Mock<() => Promise<MockedTokenBridge>>;
}

interface MockedWormholeSdkInstance {
  getChain: jest.Mock<(chainOrChainId: Chain | ChainId) => MockedChainContext>;
  getVaa: jest.Mock;
  getVaaBytes: jest.Mock<(id: WormholeMessageId, timeout?: number) => Promise<Uint8Array | null>>;
}

// Reset and override the global SDK mock
jest.resetModules();
jest.clearAllMocks();

jest.mock('@wormhole-foundation/sdk', () => {
  const actualSdk = jest.requireActual('@wormhole-foundation/sdk') as Record<string, unknown>;

  return {
    __esModule: true,
    ...actualSdk,
    wormhole: jest.fn(
      async (
        _network: Network,
        _platforms: Array<() => Promise<unknown>>,
      ): Promise<MockedWormholeSdkInstance> => {
        console.log('Mocked wormhole function called with:', _network, _platforms?.length);
        const mockTokenBridgeInstance: MockedTokenBridge = {
          isTransferCompleted: jest
            .fn<(vaa: VAA<PayloadLiteral>) => Promise<boolean>>()
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

  let mockGetVaaImplementation: any; // Use any to avoid TypeScript mock typing issues
  let mockGetVaaBytesImplementation: any;
  let mockWormholeInstance: any;
  let mockChainContext: any;
  let mockTokenBridgeOperations: any;

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
      VAA<PayloadLiteral> & {
        serialize?: jest.Mock;
        bytes?: Uint8Array;
      }
    > = {},
  ): VAA<PayloadLiteral> & {
    bytes?: Uint8Array;
    serialize: jest.Mock;
  } => {
    const mockEmitterUAddress = new ActualUniversalAddress(emitterAddressStr);
    const emitterChainName = actualChainIdToChain(emitterChainId);

    const mockSerialize = jest.fn().mockReturnValue(new Uint8Array([1, 2, 3, 4, 5]));

    const defaults = {
      id: {
        chain: emitterChainName,
        emitter: mockEmitterUAddress,
        sequence: BigInt(1),
      },
      emitterChain: emitterChainName, // This should be Chain (string), not ChainId (number)
      emitterAddress: mockEmitterUAddress,
      sequence: BigInt(1),
      consistencyLevel: 0,
      timestamp: Date.now(),
      nonce: 0,
      signatures: [],
      guardianSet: {
        index: 0,
        keys: ['0x1234567890abcdef1234567890abcdef12345678'],
      },
      payloadLiteral: 'TokenBridge:TransferWithPayload' as PayloadLiteral, // Full discriminator format
      payload: {} as PayloadLiteral,
      bytes: new Uint8Array([1, 2, 3, 4, 5]),
      serialize: mockSerialize,
      // Add properties needed for protocol validation
      protocolName: 'TokenBridge',
      payloadName: 'TokenBridge:TransferWithPayload', // Full discriminator format
    };

    const result = { ...defaults, ...overrides };

    // Ensure serialize method is always present and functional
    if (!result.serialize) {
      result.serialize = mockSerialize;
    }

    // If bytes are provided in overrides, update serialize to return those bytes
    if (overrides.bytes) {
      result.serialize.mockReturnValue(overrides.bytes);
    }

    return result as VAA<PayloadLiteral> & {
      bytes?: Uint8Array;
      serialize: jest.Mock;
    };
  };

  let service: WormholeVaaService;

  beforeEach(async () => {
    // Reset the mock implementations to jest.fn() for each test
    mockGetVaaImplementation = jest.fn(); // Simple jest.fn() assignment
    mockGetVaaBytesImplementation = jest.fn();

    mockTokenBridgeOperations = {
      isTransferCompleted: jest
        .fn<(vaa: VAA<PayloadLiteral>) => Promise<boolean>>()
        .mockResolvedValue(false),
    };

    mockChainContext = {
      parseTransaction: jest.fn<(txHash: string) => Promise<WormholeMessageId[]>>(),
      getTokenBridge: jest.fn<() => Promise<MockedTokenBridge>>(),
    };
    mockChainContext.getTokenBridge.mockResolvedValue(mockTokenBridgeOperations);

    mockWormholeInstance = {
      getChain: jest.fn().mockReturnValue(mockChainContext),
      getVaa: mockGetVaaImplementation,
      getVaaBytes: mockGetVaaBytesImplementation,
      __isMockWhInstance: true,
    } as any; // Use any to bypass strict type checking for test mocks

    mockWormholeEntry.mockImplementation(async (..._args: unknown[]) => {
      if (!mockWormholeInstance) {
        return undefined as any;
      }
      return mockWormholeInstance as any; // Use any for test mock compatibility
    });

    // Create service - this should trigger the JsonRpcProvider constructor and assign the mock references
    service = await WormholeVaaService.create(L2_RPC_STRING, TEST_NETWORK, [
      () => Promise.resolve(evmPlatform),
      () => Promise.resolve(solanaPlatform),
    ]);

    // Verify the mock references were assigned during service creation
    if (!lastMockedGetTransactionReceipt) {
      throw new Error(
        'TEST SETUP ERROR: lastMockedGetTransactionReceipt was not assigned during service creation. Check the ethers mock.',
      );
    }
    if (!lastMockedGetNetwork) {
      throw new Error(
        'TEST SETUP ERROR: lastMockedGetNetwork was not assigned during service creation. Check the ethers mock.',
      );
    }

    // TypeScript assertion: these are guaranteed to be defined after the checks above
    const mockedGetTransactionReceipt = lastMockedGetTransactionReceipt!;
    const mockedGetNetwork = lastMockedGetNetwork!;

    // Setup default mock returns for provider methods
    mockedGetTransactionReceipt.mockResolvedValue(null); // Default: no receipt
    mockedGetNetwork.mockResolvedValue({
      name: 'mock-integration-network',
      chainId: EVM_CHAIN_ID_GOERLI, // Use EVM chain ID for Ethereum Testnet (Goerli)
    } as EthersProviders.Network);

    // Setup common mock VAA data
    const mockReceipt = createMockReceipt(1, L2_TX_HASH);
    mockedGetTransactionReceipt.mockResolvedValue(mockReceipt);
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
    mockSdkDeserialize.mockImplementation((discriminator, _bytes) => {
      // Default behavior: throw, forcing tests to be specific.
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

    describe('Successful VAA Fetch and Verification', () => {
      test('should successfully fetch, parse, verify, and return VAA', async () => {
        const mockReceipt = createMockReceipt(1, L2_TX_HASH);
        lastMockedGetTransactionReceipt!.mockResolvedValue(mockReceipt);

        lastMockedGetNetwork!.mockResolvedValue({
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

        expect(lastMockedGetTransactionReceipt!).toHaveBeenCalledWith(L2_TX_HASH);
        expect(mockChainContext.parseTransaction).toHaveBeenCalledWith(L2_TX_HASH);
      });

      test('should successfully fetch VAA when VAA has .serialize()', async () => {
        const mockReceipt = createMockReceipt(1, L2_TX_HASH);
        lastMockedGetTransactionReceipt!.mockResolvedValue(mockReceipt);

        lastMockedGetNetwork!.mockResolvedValue({
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

        expect(lastMockedGetTransactionReceipt!).toHaveBeenCalledWith(L2_TX_HASH);
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
        lastMockedGetTransactionReceipt!.mockRejectedValue(new Error('Provider unavailable'));
        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          l2ChainIdForTests,
          EMITTER_ADDRESS_STR,
          targetL1ChainIdForTests,
        );
        expect(result).toBeNull();
        expect(lastMockedGetTransactionReceipt!).toHaveBeenCalledWith(L2_TX_HASH);
        expect(mockLogErrorContext).toHaveBeenCalledWith(
          `Failed to get L2 transaction receipt for ${L2_TX_HASH}. Original error: Provider unavailable`,
          expect.any(Error), // The service logs the original error caught
        );
      });

      test('should return null if L2 transaction receipt is null', async () => {
        lastMockedGetTransactionReceipt!.mockResolvedValue(
          null as EthersProviders.TransactionReceipt | null,
        );
        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          l2ChainIdForTests,
          EMITTER_ADDRESS_STR,
          targetL1ChainIdForTests,
        );
        expect(result).toBeNull();
        expect(lastMockedGetTransactionReceipt!).toHaveBeenCalledWith(L2_TX_HASH);
        expect(mockLogErrorContext).toHaveBeenCalledWith(
          expect.stringContaining(
            `Failed to get L2 transaction receipt for ${L2_TX_HASH} on ${actualChainIdToChain(l2ChainIdForTests)}. Receipt is null.`,
          ),
          expect.objectContaining({ message: 'L2 transaction receipt is null' }),
        );
      });

      test('should return null if L2 transaction failed (status 0)', async () => {
        const mockReceipt = createMockReceipt(0, L2_TX_HASH);
        lastMockedGetTransactionReceipt!.mockResolvedValue(
          mockReceipt as EthersProviders.TransactionReceipt,
        );
        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          l2ChainIdForTests,
          EMITTER_ADDRESS_STR,
          targetL1ChainIdForTests,
        );
        expect(result).toBeNull();
        expect(lastMockedGetTransactionReceipt!).toHaveBeenCalledWith(L2_TX_HASH);
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
        lastMockedGetTransactionReceipt!.mockResolvedValue(
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
        expect(lastMockedGetTransactionReceipt!).toHaveBeenCalledWith(L2_TX_HASH);
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
        lastMockedGetTransactionReceipt!.mockResolvedValue(mockReceipt);
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
        lastMockedGetTransactionReceipt!.mockResolvedValue(mockReceipt);
        const mockWormholeMessageId: WormholeMessageId = {
          chain: actualChainIdToChain(ETHEREUM_CHAIN_ID),
          emitter: new ActualUniversalAddress(EMITTER_ADDRESS_STR),
          sequence: BigInt(1),
        };
        mockChainContext.parseTransaction.mockResolvedValue([mockWormholeMessageId]);
        mockTokenBridgeOperations.isTransferCompleted.mockResolvedValue(true);
        mockBaseVaa = createMockVaa(EMITTER_ADDRESS_STR, ETHEREUM_CHAIN_ID, {
          guardianSet: 0,
          payloadName: 'TransferWithPayload',
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
        lastMockedGetTransactionReceipt!.mockResolvedValue(mockReceipt);
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
          lastMockedGetTransactionReceipt!.mockResolvedValue(mockReceipt);
          const mockEmitterUAddress = new ActualUniversalAddress(EMITTER_ADDRESS_STR);
          const mockWormholeMessageId: WormholeMessageId = {
            chain: actualChainIdToChain(ETHEREUM_CHAIN_ID),
            emitter: mockEmitterUAddress,
            sequence: BigInt(1),
          };
          mockChainContext.parseTransaction.mockResolvedValue([mockWormholeMessageId]);

          const baseVaa = createMockVaa(EMITTER_ADDRESS_STR, ETHEREUM_CHAIN_ID, {
            guardianSet: 0,
            payloadName: 'TransferWithPayload',
            payloadLiteral: 'TokenBridge:TransferWithPayload',
          }) as VAA<'TokenBridge:TransferWithPayload'> & {
            serialize: jest.Mock<() => Uint8Array>;
            bytes?: Uint8Array;
          };

          // CRITICAL FIX: Mock getVaa to return the baseVaa so service can proceed to L1 transfer completion logic
          mockGetVaaImplementation.mockResolvedValue(baseVaa);

          const l1TokenBridgeOperationsMock: typeof mockTokenBridgeOperations = {
            isTransferCompleted: jest
              .fn<(vaa: VAA<PayloadLiteral>) => Promise<boolean>>()
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
          mockWormholeInstance.getChain.mockImplementation((chainOrChainId: Chain | ChainId) => {
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
