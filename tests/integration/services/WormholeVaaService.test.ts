// THIS MUST BE AT THE VERY TOP, BEFORE ANY OTHER IMPORTS THAT MIGHT PULL IN 'ethers'
// import { jest } from '@jest/globals';
// import {
//   // mockJsonRpcProviderConstructor_for_tests_setup, // Will define locally now
//   mockGetTransactionReceiptFn_setup,   // Still import these helpers
//   mockGetNetworkFn_setup,
// } from '../../setup.js';

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
import { ethers, type providers as EthersProviders, BigNumber as EthersBigNumber } from 'ethers';

// SDK related imports from @wormhole-foundation/sdk (mocked via setup.ts)
import {
  wormhole,
  Wormhole,
  UniversalAddress as ActualUniversalAddress,
  type Network,
  type ChainId,
  chainIdToChain as actualChainIdToChain,
  type WormholeMessageId,
  type Chain,
  type VAA,
  toChainId,
  type PayloadLiteral,
} from '@wormhole-foundation/sdk';

import logger, { logErrorContext } from '../../../utils/Logger.js';
import { stringifyWithBigInt } from '../../../utils/Numbers.js';
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

describe('WormholeVaaService', () => {
  const L2_RPC_STRING = 'http://localhost:8545'; // For testing the string RPC path
  const TEST_NETWORK: Network = 'Testnet';
  const L2_TX_HASH = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const EMITTER_ADDRESS_STR = '0x000000000000000000000000000000000000dead';

  const ETHEREUM_CHAIN_ID = toChainId('Ethereum');
  const ARBITRUM_CHAIN_ID = toChainId('Arbitrum');
  const SOLANA_CHAIN_ID = toChainId('Solana');
  const POLYGON_CHAIN_ID = toChainId('Polygon');

  let mockGetVaaImplementation: jest.MockedFunction<
    <T extends PayloadLiteral>(
      id: WormholeMessageId,
      decodeAs: T,
      timeout?: number,
    ) => Promise<VAA<T> | null>
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
    jest.clearAllMocks();

    mockGetTransactionReceiptFn_instance =
      jest.fn<(txHash: string) => Promise<EthersProviders.TransactionReceipt | null>>();
    mockGetNetworkFn_instance = jest.fn<() => Promise<EthersProviders.Network>>();
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
      (
        id: WormholeMessageId,
        decodeAs: PayloadLiteral,
        timeout?: number,
      ) => Promise<VAA<PayloadLiteral> | null>
    >() as jest.MockedFunction<
      <T extends PayloadLiteral>(
        id: WormholeMessageId,
        decodeAs: T,
        timeout?: number,
      ) => Promise<VAA<T> | null>
    >;
    mockGetVaaImplementation.mockResolvedValue(null);

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
      getVaa: mockGetVaaImplementation,
      __isMockWhInstance: true,
    } as any;
    mockWormholeEntry.mockImplementation(async (...args: any[]) => {
      if (!mockWormholeInstance) {
        return undefined;
      }
      return mockWormholeInstance as any;
    });

    service = await WormholeVaaService.create(mockL2ProviderInstance, TEST_NETWORK, [
      evmPlatform,
      solanaPlatform,
    ]);
  });

  describe('create', () => {
    test('should successfully create an instance with a provider instance and initialize Wormhole SDK', async () => {
      expect(service).toBeInstanceOf(WormholeVaaService);
      expect(mockWormholeEntry).toHaveBeenCalledWith(TEST_NETWORK, [
        expect.anything(),
        expect.anything(),
      ]);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('WormholeVaaService created'),
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('L2 Provider: provided_instance'),
      );
    });

    test('should successfully create an instance with an RPC string (this will use actual JsonRpcProvider)', async () => {
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

    test('should throw an error if wormhole SDK initialization fails (returns null), when created with provider instance', async () => {
      mockWormholeEntry.mockResolvedValue(null as any);
      await expect(WormholeVaaService.create(mockL2ProviderInstance)).rejects.toThrow(
        '[WormholeVaaService.create] wormhole SDK initialization failed: wormhole() returned null or undefined.',
      );
    });

    test('should throw an error if wormhole SDK initialization fails (throws error), when created with provider instance', async () => {
      const sdkInitError = new Error('Wormhole SDK init failed for some reason');
      mockWormholeEntry.mockRejectedValue(sdkInitError);
      await expect(WormholeVaaService.create(mockL2ProviderInstance)).rejects.toThrow(sdkInitError);
    });
  });

  describe('fetchAndVerifyVaaForL2Event', () => {
    describe('Successful VAA Fetch and Verification', () => {
      test('should successfully fetch, parse, verify, and return VAA (using mock provider instance)', async () => {
        const mockReceipt = createMockReceipt(1, L2_TX_HASH);
        mockGetTransactionReceiptFn_instance.mockResolvedValue(mockReceipt);

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
        mockGetVaaImplementation.mockResolvedValue(mockParsedVaaWithBytes as VAA<any>);
        mockTokenBridgeOperations.isTransferCompleted.mockResolvedValue(true);

        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          ETHEREUM_CHAIN_ID,
          EMITTER_ADDRESS_STR,
          ARBITRUM_CHAIN_ID,
        );
        expect(result).not.toBeNull();
        expect(result?.vaaBytes).toBe(mockVaaBytes);
        expect(result?.parsedVaa).toBe(mockParsedVaaWithBytes);
        expect(mockGetTransactionReceiptFn_instance).toHaveBeenCalledWith(L2_TX_HASH);
        expect(mockChainContext.parseTransaction).toHaveBeenCalledWith(L2_TX_HASH);
      });

      test('should successfully fetch VAA when VAA has .serialize() (using mock provider instance)', async () => {
        const mockReceipt = createMockReceipt(1, L2_TX_HASH);
        mockGetTransactionReceiptFn_instance.mockResolvedValue(mockReceipt);
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

        mockGetVaaImplementation.mockImplementation(async (id, decodeAs, timeout) => {
          if (decodeAs === 'TokenBridge:Transfer') {
            return mockParsedVaaNoBytes as any;
          } else if (decodeAs === 'TokenBridge:TransferWithPayload') {
            return null;
          }
          return null;
        });

        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          ETHEREUM_CHAIN_ID,
          EMITTER_ADDRESS_STR,
          ARBITRUM_CHAIN_ID,
        );
        expect(result).not.toBeNull();
        expect(result?.vaaBytes).toEqual(mockVaaBytesSerialized);
        expect(mockGetTransactionReceiptFn_instance).toHaveBeenCalledWith(L2_TX_HASH);
        expect(mockParsedVaaNoBytes.serialize).toHaveBeenCalled();
      });
    });

    describe('L2 transaction issues', () => {
      test('should return null if getTransactionReceipt fails to return a receipt', async () => {
        mockGetTransactionReceiptFn_instance.mockResolvedValue(null);
        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          ETHEREUM_CHAIN_ID,
          EMITTER_ADDRESS_STR,
          ARBITRUM_CHAIN_ID,
        );
        expect(result).toBeNull();
        expect(mockGetTransactionReceiptFn_instance).toHaveBeenCalledWith(L2_TX_HASH);
        expect(mockLogErrorContext).toHaveBeenCalledWith(
          expect.stringContaining(`Failed to get L2 transaction receipt for ${L2_TX_HASH}`),
          expect.any(Error),
        );
      });

      test('should return null if the L2 transaction has reverted (receipt status 0)', async () => {
        const mockRevertedReceipt = createMockReceipt(0, L2_TX_HASH);
        mockGetTransactionReceiptFn_instance.mockResolvedValue(mockRevertedReceipt);
        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          ETHEREUM_CHAIN_ID,
          EMITTER_ADDRESS_STR,
          ARBITRUM_CHAIN_ID,
        );
        expect(result).toBeNull();
        expect(mockGetTransactionReceiptFn_instance).toHaveBeenCalledWith(L2_TX_HASH);
        expect(mockLogErrorContext).toHaveBeenCalledWith(
          expect.stringContaining(`L2 transaction ${L2_TX_HASH} failed (reverted)`),
          expect.any(Error),
        );
      });
    });

    describe('wormhole message parsing', () => {
      beforeEach(() => {
        const mockReceipt = createMockReceipt(1, L2_TX_HASH);
        mockGetTransactionReceiptFn_instance.mockResolvedValue(mockReceipt);
      });

      test('Test 2.3.1: Should return null if parseTransaction returns no Wormhole messages', async () => {
        mockChainContext.parseTransaction.mockResolvedValue([]);
        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          ETHEREUM_CHAIN_ID,
          EMITTER_ADDRESS_STR,
          ARBITRUM_CHAIN_ID,
        );
        expect(result).toBeNull();
        expect(mockGetTransactionReceiptFn_instance).toHaveBeenCalledWith(L2_TX_HASH);
        expect(mockChainContext.parseTransaction).toHaveBeenCalledWith(L2_TX_HASH);
        expect(mockLogErrorContext).toHaveBeenCalledWith(
          expect.stringContaining(`No Wormhole messages found in L2 transaction ${L2_TX_HASH}`),
          expect.any(Error),
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
            `Could not find Wormhole message from emitter ${EMITTER_ADDRESS_STR}`,
          ),
          expect.objectContaining({ message: 'Relevant WormholeMessageId not found' }),
        );
      });
    });

    describe('getVaa() issues', () => {
      let mockWormholeMessageId: WormholeMessageId;
      beforeEach(() => {
        const mockReceipt = createMockReceipt(1, L2_TX_HASH);
        mockGetTransactionReceiptFn_instance.mockResolvedValue(mockReceipt);
        mockWormholeMessageId = {
          chain: actualChainIdToChain(ETHEREUM_CHAIN_ID),
          emitter: new ActualUniversalAddress(EMITTER_ADDRESS_STR),
          sequence: BigInt(1),
        };
        mockChainContext.parseTransaction.mockResolvedValue([mockWormholeMessageId]);
        mockTokenBridgeOperations.isTransferCompleted.mockResolvedValue(true);
      });

      test('should return null if this.wh.getVaa() throws an error for both payload types', async () => {
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
          'TokenBridge:TransferWithPayload',
          EXPECTED_GET_VAA_TIMEOUT_MS,
        );
        expect(mockGetVaaImplementation).toHaveBeenCalledWith(
          mockWormholeMessageId,
          'TokenBridge:Transfer',
          EXPECTED_GET_VAA_TIMEOUT_MS,
        );
        expect(mockLogErrorContext).toHaveBeenLastCalledWith(
          expect.stringContaining(
            `this.wh.getVaa did not return a VAA for message ID ${stringifyWithBigInt(
              mockWormholeMessageId,
            )} after trying all discriminators. Last error: ${getVaaError.message}`,
          ),
          expect.objectContaining({
            message: 'this.wh.getVaa failed or returned null VAA after all retries',
          }),
        );
      });

      test('Test 2.4.2: Should return null if this.wh.getVaa() returns null for both payload types', async () => {
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
          'TokenBridge:TransferWithPayload',
          EXPECTED_GET_VAA_TIMEOUT_MS,
        );
        expect(mockGetVaaImplementation).toHaveBeenCalledWith(
          mockWormholeMessageId,
          'TokenBridge:Transfer',
          EXPECTED_GET_VAA_TIMEOUT_MS,
        );
        expect(mockLogErrorContext).toHaveBeenCalledWith(
          expect.stringContaining(
            `this.wh.getVaa did not return a VAA for message ID ${stringifyWithBigInt(mockWormholeMessageId)}`,
          ),
          expect.objectContaining({
            message: 'this.wh.getVaa failed or returned null VAA after all retries',
          }),
        );
      });
    });

    describe('initial VAA verification failures', () => {
      let mockBaseVaa: VAA<'TokenBridge:TransferWithPayload'> & {
        serialize: jest.Mock<() => Uint8Array>;
      };

      beforeEach(() => {
        const mockReceipt = createMockReceipt(1, L2_TX_HASH);
        mockGetTransactionReceiptFn_instance.mockResolvedValue(mockReceipt);
        const mockWormholeMessageId: WormholeMessageId = {
          chain: actualChainIdToChain(ETHEREUM_CHAIN_ID),
          emitter: new ActualUniversalAddress(EMITTER_ADDRESS_STR),
          sequence: BigInt(1),
        };
        mockChainContext.parseTransaction.mockResolvedValue([mockWormholeMessageId]);
        mockTokenBridgeOperations.isTransferCompleted.mockResolvedValue(true);
        mockBaseVaa = createMockVaa(
          EMITTER_ADDRESS_STR,
          ETHEREUM_CHAIN_ID,
          {},
        ) as VAA<'TokenBridge:TransferWithPayload'> & { serialize: jest.Mock<() => Uint8Array> };
        mockGetVaaImplementation.mockResolvedValue(
          mockBaseVaa as VAA<'TokenBridge:TransferWithPayload'>,
        );
      });

      test('should return null if VAA emitterChain mismatch', async () => {
        const mismatchedParsedVaa = createMockVaa(EMITTER_ADDRESS_STR, ETHEREUM_CHAIN_ID, {
          emitterChain: actualChainIdToChain(SOLANA_CHAIN_ID),
        });
        mockGetVaaImplementation.mockResolvedValue(
          mismatchedParsedVaa as VAA<'TokenBridge:TransferWithPayload'>,
        );
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
        });
        mockGetVaaImplementation.mockResolvedValue(
          mismatchedEmitterAddressVaa as VAA<'TokenBridge:TransferWithPayload'>,
        );
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
          consistencyLevel: MIN_VAA_CONSISTENCY_LEVEL_IN_SERVICE,
        });
        mockGetVaaImplementation.mockResolvedValue(
          lowConsistencyVaa as VAA<'TokenBridge:TransferWithPayload'>,
        );
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
            `VAA verification warning: Low consistency level. Expected ${MIN_VAA_CONSISTENCY_LEVEL_IN_SERVICE}, Got: ${MIN_VAA_CONSISTENCY_LEVEL_IN_SERVICE}`,
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
        });
        mockGetVaaImplementation.mockResolvedValue(
          mockVaaWithCLZero as VAA<'TokenBridge:TransferWithPayload'>,
        );
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
        mockGetTransactionReceiptFn_instance.mockResolvedValue(mockReceipt);
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
        });
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
        });
        mockGetVaaImplementation.mockResolvedValue(vaaWithWrongPayloadName);
        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          ETHEREUM_CHAIN_ID,
          EMITTER_ADDRESS_STR,
          ARBITRUM_CHAIN_ID,
        );
        expect(result).toBeNull();
        expect(mockLogErrorContext).toHaveBeenCalledWith(
          expect.stringContaining('VAA verification failed: Payload name mismatch'),
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
          mockGetTransactionReceiptFn_instance.mockResolvedValue(mockReceipt);
          const mockEmitterUAddress = new ActualUniversalAddress(EMITTER_ADDRESS_STR);
          const mockWormholeMessageId: WormholeMessageId = {
            chain: actualChainIdToChain(ETHEREUM_CHAIN_ID),
            emitter: mockEmitterUAddress,
            sequence: BigInt(1),
          };
          mockChainContext.parseTransaction.mockResolvedValue([mockWormholeMessageId]);
          const baseVaa = createMockVaa(EMITTER_ADDRESS_STR, ETHEREUM_CHAIN_ID);
          mockGetVaaImplementation.mockResolvedValue(
            baseVaa as VAA<'TokenBridge:TransferWithPayload'>,
          );
          const l1TokenBridgeOperationsMock: typeof mockTokenBridgeOperations = {
            isTransferCompleted: jest
              .fn<(vaa: VAA<any>) => Promise<boolean>>()
              .mockResolvedValue(true),
          };
          const l1ChainContextMock: typeof mockChainContext = {
            parseTransaction: jest
              .fn<(txHash: string) => Promise<WormholeMessageId[]>>()
              .mockResolvedValue([]),
            getTokenBridge: jest
              .fn<() => Promise<any>>()
              .mockResolvedValue(l1TokenBridgeOperationsMock),
          };
          setupL1Mocks(l1ChainContextMock, l1TokenBridgeOperationsMock);
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
