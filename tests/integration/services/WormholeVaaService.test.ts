import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { WormholeVaaService } from '../../../services/WormholeVaaService.js';
import { ethers } from 'ethers';
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

jest.mock('@wormhole-foundation/sdk', () => {
  const originalSdk = jest.requireActual('@wormhole-foundation/sdk') as any;

  return {
    __esModule: true,
    ...originalSdk,
    wormhole: jest.fn(),
    chainIdToChain: jest.fn((id: ChainId) => originalSdk.chainIdToChain(id)),
    UniversalAddress: jest.fn((...args: any[]) => new originalSdk.UniversalAddress(...args)),
    toChainId: originalSdk.toChainId,
  };
});

const mockChainIdToChainFn = jest.fn<(id: ChainId) => Chain>();
const mockUniversalAddressConstructorFn =
  jest.fn<(addr: string | Uint8Array) => ActualUniversalAddress>();

// Get references to the mocked functions
const mockWormholeSdk = jest.requireMock('@wormhole-foundation/sdk') as any;
mockWormholeSdk.chainIdToChain = mockChainIdToChainFn;
mockWormholeSdk.UniversalAddress = jest.fn((arg: string | Uint8Array) =>
  mockUniversalAddressConstructorFn(arg),
);

jest.mock('ethers', () => {
  const originalEthers = jest.requireActual('ethers') as Record<string, any>;
  return {
    ...originalEthers,
    ethers: {
      ...originalEthers.ethers,
      providers: {
        JsonRpcProvider: jest.fn().mockImplementation(() => ({
          getTransactionReceipt:
            jest.fn<() => Promise<ethers.providers.TransactionReceipt | null>>(),
        })),
      },
    },
  };
});

jest.mock('../../../utils/Logger.js', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  logErrorContext: jest.fn(),
}));

// --- Typed Mocks ---
const mockWormholeEntry = wormhole as jest.MockedFunction<typeof wormhole>;
const mockEthersJsonRpcProviderConstructor = ethers.providers
  .JsonRpcProvider as jest.MockedFunction<any>;

const mockLogger = logger as jest.Mocked<typeof logger>;
const mockLogErrorContext = logErrorContext as jest.MockedFunction<typeof logErrorContext>;

// Default timeout used in the service for getVaa calls
const EXPECTED_GET_VAA_TIMEOUT_MS = 300000;

describe('WormholeVaaService', () => {
  const L2_RPC = 'http://localhost:8545';
  const TEST_NETWORK: Network = 'Testnet';

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
  let mockL2Provider: {
    getTransactionReceipt: jest.MockedFunction<
      (txHash: string) => Promise<ethers.providers.TransactionReceipt | null>
    >;
  };

  const ETHEREUM_CHAIN_ID = toChainId('Ethereum');
  const ARBITRUM_CHAIN_ID = toChainId('Arbitrum');
  const SOLANA_CHAIN_ID = toChainId('Solana');
  const POLYGON_CHAIN_ID = toChainId('Polygon');

  const createMockReceipt = (status: number, hash: string): ethers.providers.TransactionReceipt =>
    ({
      status,
      transactionHash: hash,
      logs: [],
      to: '0xcontractaddress',
      from: '0xsenderaddress',
      contractAddress: undefined,
      transactionIndex: 1,
      blockHash: '0xblockhash',
      blockNumber: 123,
      gasUsed: ethers.BigNumber.from('21000'),
      cumulativeGasUsed: ethers.BigNumber.from('21000'),
      effectiveGasPrice: ethers.BigNumber.from('1000000000'),
      type: 0,
      confirmations: 10,
      logsBloom: '0x' + '0'.repeat(512),
      byzantium: true,
    }) as unknown as ethers.providers.TransactionReceipt;

  const createMockVaa = (
    L2_TX_HASH: string,
    EMITTER_ADDRESS_STR: string,
    ETHEREUM_CHAIN_ID: ChainId,
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
    const mockEmitterUAddress = new ActualUniversalAddress(EMITTER_ADDRESS_STR);
    const defaults = {
      emitterChain: actualChainIdToChain(ETHEREUM_CHAIN_ID),
      emitterAddress: mockEmitterUAddress,
      sequence: BigInt(1),
      consistencyLevel: 15,
      protocolName: 'TokenBridge',
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

  beforeEach(async () => {
    jest.clearAllMocks();

    const originalSdk = jest.requireActual('@wormhole-foundation/sdk') as any;
    mockChainIdToChainFn.mockImplementation((id: ChainId) => originalSdk.chainIdToChain(id));
    mockUniversalAddressConstructorFn.mockImplementation(
      (addr: string | Uint8Array) => new originalSdk.UniversalAddress(addr),
    );

    mockGetVaaImplementation = jest.fn() as jest.MockedFunction<
      <T extends PayloadLiteral>(
        id: WormholeMessageId,
        decodeAs: T,
        timeout?: number,
      ) => Promise<VAA<T> | null>
    >;
    mockL2Provider = {
      getTransactionReceipt:
        jest.fn<(txHash: string) => Promise<ethers.providers.TransactionReceipt | null>>(),
    };
    mockEthersJsonRpcProviderConstructor.mockReturnValue(mockL2Provider as any);
    mockTokenBridgeOperations = {
      isTransferCompleted: jest.fn<(vaa: VAA<any>) => Promise<boolean>>(),
    };
    mockChainContext = {
      parseTransaction: jest.fn<(txHash: string) => Promise<WormholeMessageId[]>>(),
      getTokenBridge: jest.fn<() => Promise<any>>().mockResolvedValue(mockTokenBridgeOperations),
    };
    mockWormholeInstance = {
      getChain: jest.fn<(chain: Chain | ChainId) => any>().mockReturnValue(mockChainContext),
      getVaa: mockGetVaaImplementation,
    };
    mockWormholeEntry.mockResolvedValue(mockWormholeInstance as unknown as Wormhole<Network>);
  });

  describe('create', () => {
    test('should successfully create an instance and initialize Wormhole SDK', async () => {
      const service = await WormholeVaaService.create(L2_RPC, TEST_NETWORK);
      expect(service).toBeInstanceOf(WormholeVaaService);
      expect(mockWormholeEntry).toHaveBeenCalledWith(TEST_NETWORK, [
        expect.anything(),
        expect.anything(),
      ]);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('WormholeVaaService created'),
      );
    });

    test('should use default network and platform modules if not provided', async () => {
      await WormholeVaaService.create(L2_RPC);
      expect(mockWormholeEntry).toHaveBeenCalledWith('Testnet', [
        expect.anything(),
        expect.anything(),
      ]);
    });
  });

  describe('fetchAndVerifyVaaForL2Event', () => {
    const L2_TX_HASH = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const EMITTER_ADDRESS_STR = '0x000000000000000000000000000000000000dead';
    let service: WormholeVaaService;

    beforeEach(async () => {
      // Re-establish mocks for this describe block
      mockGetVaaImplementation = jest.fn() as jest.MockedFunction<any>;
      mockL2Provider = {
        getTransactionReceipt:
          jest.fn<(txHash: string) => Promise<ethers.providers.TransactionReceipt | null>>(),
      };
      mockEthersJsonRpcProviderConstructor.mockReturnValue(mockL2Provider as any);
      mockTokenBridgeOperations = {
        isTransferCompleted: jest.fn<(vaa: VAA<any>) => Promise<boolean>>(),
      };
      mockChainContext = {
        parseTransaction: jest.fn<(txHash: string) => Promise<WormholeMessageId[]>>(),
        getTokenBridge: jest.fn<() => Promise<any>>().mockResolvedValue(mockTokenBridgeOperations),
      };
      mockWormholeInstance = {
        getChain: jest.fn<(chain: Chain | ChainId) => any>().mockReturnValue(mockChainContext),
        getVaa: mockGetVaaImplementation,
      };
      mockWormholeEntry.mockResolvedValue(mockWormholeInstance as unknown as Wormhole<Network>);

      service = await WormholeVaaService.create(L2_RPC, TEST_NETWORK);
    });

    describe('Successful VAA Fetch and Verification', () => {
      test('should successfully fetch, parse, verify, and return VAA (VAA with .bytes)', async () => {
        const mockReceipt = createMockReceipt(1, L2_TX_HASH);
        mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);

        const mockEmitterUAddress = new ActualUniversalAddress(EMITTER_ADDRESS_STR);
        const mockWormholeMessageId: WormholeMessageId = {
          chain: actualChainIdToChain(ETHEREUM_CHAIN_ID),
          emitter: mockEmitterUAddress,
          sequence: BigInt(1),
        };
        mockChainContext.parseTransaction.mockResolvedValue([mockWormholeMessageId]);

        const mockVaaBytes = new Uint8Array([1, 2, 3, 4, 5]);
        const mockParsedVaaWithBytes: any = {
          emitterChain: actualChainIdToChain(ETHEREUM_CHAIN_ID),
          emitterAddress: mockEmitterUAddress,
          sequence: BigInt(1),
          consistencyLevel: 15,
          protocolName: 'TokenBridge',
          payloadName: 'TransferWithPayload',
          payloadLiteral: 'TokenBridge:TransferWithPayload',
          payload: { somePayloadData: 'data' } as any,
          guardianSet: 0,
          timestamp: Math.floor(Date.now() / 1000),
          nonce: 0,
          signatures: [] as any[],
          hash: new Uint8Array(32).fill(1),
          bytes: mockVaaBytes,
        };
        mockGetVaaImplementation.mockResolvedValue(
          mockParsedVaaWithBytes as VAA<'TokenBridge:TransferWithPayload'>,
        );
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
        expect(mockL2Provider.getTransactionReceipt).toHaveBeenCalledWith(L2_TX_HASH);
        expect(mockChainContext.parseTransaction).toHaveBeenCalledWith(L2_TX_HASH);
        expect(mockGetVaaImplementation).toHaveBeenCalledWith(
          mockWormholeMessageId,
          'TokenBridge:TransferWithPayload',
          EXPECTED_GET_VAA_TIMEOUT_MS,
        );
        expect(mockChainContext.getTokenBridge).toHaveBeenCalledTimes(1);
        expect(mockTokenBridgeOperations.isTransferCompleted).toHaveBeenCalledWith(
          mockParsedVaaWithBytes,
        );
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('VAA fetched and verified'),
        );
      });

      test('should successfully fetch VAA when VAA has .serialize()', async () => {
        const mockReceipt = createMockReceipt(1, L2_TX_HASH);
        mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);

        const mockEmitterUAddress = new ActualUniversalAddress(EMITTER_ADDRESS_STR);
        const mockWormholeMessageId: WormholeMessageId = {
          chain: actualChainIdToChain(ETHEREUM_CHAIN_ID),
          emitter: mockEmitterUAddress,
          sequence: BigInt(1),
        };
        mockChainContext.parseTransaction.mockResolvedValue([mockWormholeMessageId]);
        mockTokenBridgeOperations.isTransferCompleted.mockResolvedValue(true);

        const mockVaaBytesSerialized = new Uint8Array([5, 4, 3, 2, 1]);
        const mockParsedVaaNoBytes: VAA<'TokenBridge:Transfer'> & { serialize: () => Uint8Array } =
          {
            emitterChain: actualChainIdToChain(ETHEREUM_CHAIN_ID),
            emitterAddress: mockEmitterUAddress,
            sequence: BigInt(1),
            consistencyLevel: 15,
            protocolName: 'TokenBridge',
            payloadName: 'Transfer',
            payloadLiteral: 'TokenBridge:Transfer',
            payload: { basicTransfer: 'info' } as any,
            guardianSet: 0,
            timestamp: Math.floor(Date.now() / 1000),
            nonce: 0,
            signatures: [] as any[],
            hash: new Uint8Array(32).fill(2),
            serialize: jest.fn<() => Uint8Array>().mockReturnValue(mockVaaBytesSerialized),
          };
        mockGetVaaImplementation.mockImplementation(
          async <T extends PayloadLiteral>(
            id: WormholeMessageId,
            decodeAs: T,
            timeout?: number,
          ) => {
            if (decodeAs === 'TokenBridge:Transfer') {
              return mockParsedVaaNoBytes as any as VAA<T>;
            }
            return null as any as VAA<T>;
          },
        );

        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          ETHEREUM_CHAIN_ID,
          EMITTER_ADDRESS_STR,
          ARBITRUM_CHAIN_ID,
        );

        expect(result).not.toBeNull();
        expect(result?.vaaBytes).toBe(mockVaaBytesSerialized);
        expect(result?.parsedVaa).toBe(mockParsedVaaNoBytes);
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
        expect(mockParsedVaaNoBytes.serialize).toHaveBeenCalled();
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('VAA fetched and verified'),
        );
      });
    });

    describe(' L2 transaction issues', () => {
      test('should return null if getTransactionReceipt fails to return a receipt', async () => {
        mockL2Provider.getTransactionReceipt.mockResolvedValue(null);

        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          ETHEREUM_CHAIN_ID,
          EMITTER_ADDRESS_STR,
          ARBITRUM_CHAIN_ID,
        );

        expect(result).toBeNull();
        expect(mockLogErrorContext).toHaveBeenCalledWith(
          expect.stringContaining(`Failed to get L2 transaction receipt for ${L2_TX_HASH}`),
          expect.objectContaining({ message: 'L2 tx receipt fetch failed' }),
        );
      });

      test('should return null if the L2 transaction has reverted (receipt status 0)', async () => {
        const mockRevertedReceipt = createMockReceipt(0, L2_TX_HASH);
        mockL2Provider.getTransactionReceipt.mockResolvedValue(mockRevertedReceipt);

        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          ETHEREUM_CHAIN_ID,
          EMITTER_ADDRESS_STR,
          ARBITRUM_CHAIN_ID,
        );

        expect(result).toBeNull();
        expect(mockLogErrorContext).toHaveBeenCalledWith(
          expect.stringContaining(`L2 transaction ${L2_TX_HASH} failed (reverted)`),
          expect.objectContaining({ message: 'L2 tx reverted' }),
        );
      });
    });

    describe('wormhole message parsing', () => {
      beforeEach(() => {
        const mockReceipt = createMockReceipt(1, L2_TX_HASH);
        mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);
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
        expect(mockChainContext.parseTransaction).toHaveBeenCalledWith(L2_TX_HASH);
        expect(mockLogErrorContext).toHaveBeenCalledWith(
          expect.stringContaining(`No Wormhole messages found in L2 transaction ${L2_TX_HASH}`),
          expect.objectContaining({ message: 'parseTransaction returned no messages' }),
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
        mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);

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
            `this.wh.getVaa did not return a VAA for message ID ${stringifyWithBigInt(mockWormholeMessageId)} after trying all discriminators. Last error: ${getVaaError.message}`,
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
      let mockEmitterUAddress: ActualUniversalAddress;

      beforeEach(() => {
        const mockReceipt = createMockReceipt(1, L2_TX_HASH);
        mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);
        mockEmitterUAddress = new ActualUniversalAddress(EMITTER_ADDRESS_STR);
        const mockWormholeMessageId: WormholeMessageId = {
          chain: actualChainIdToChain(ETHEREUM_CHAIN_ID),
          emitter: mockEmitterUAddress,
          sequence: BigInt(1),
        };
        mockChainContext.parseTransaction.mockResolvedValue([mockWormholeMessageId]);
        mockTokenBridgeOperations.isTransferCompleted.mockResolvedValue(true);

        mockBaseVaa = {
          emitterChain: actualChainIdToChain(ETHEREUM_CHAIN_ID),
          emitterAddress: mockEmitterUAddress,
          sequence: BigInt(1),
          consistencyLevel: 15,
          protocolName: 'TokenBridge',
          payloadName: 'TransferWithPayload',
          payloadLiteral: 'TokenBridge:TransferWithPayload',
          payload: {} as any,
          serialize: jest.fn<() => Uint8Array>().mockReturnValue(new Uint8Array([1, 2, 3])),
          guardianSet: 0,
          timestamp: 0,
          nonce: 0,
          signatures: [] as any[],
          hash: new Uint8Array(32).fill(3),
        };
        mockGetVaaImplementation.mockResolvedValue(
          mockBaseVaa as VAA<'TokenBridge:TransferWithPayload'>,
        );
      });

      test('should return null if VAA emitterChain mismatch', async () => {
        const mismatchedParsedVaa = {
          ...mockBaseVaa,
          emitterChain: actualChainIdToChain(SOLANA_CHAIN_ID),
        };
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
          expect.stringContaining('Initial VAA verification (emitter check) failed'),
          expect.objectContaining({ message: 'Initial VAA verification failed' }),
        );
      });

      test('should return null if VAA emitterAddress mismatch', async () => {
        const wrongEmitterAddressStr = '0xbad0000000000000000000000000000000000bad';
        const mismatchedEmitterAddressVaa = {
          ...mockBaseVaa,
          emitterAddress: new ActualUniversalAddress(wrongEmitterAddressStr),
        };
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
          expect.stringContaining('Initial VAA verification (emitter check) failed'),
          expect.objectContaining({ message: 'Initial VAA verification failed' }),
        );
      });

      test('low consistency level should log warning but pass verification if other checks are ok', async () => {
        const MIN_VAA_CONSISTENCY_LEVEL_IN_SERVICE = 1;
        const lowConsistencyVaa = {
          ...mockBaseVaa,
          consistencyLevel: MIN_VAA_CONSISTENCY_LEVEL_IN_SERVICE,
        };
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

      test(' VAA with consistency level 0 should pass verification and not log MIN_VAA_CONSISTENCY_LEVEL warning', async () => {
        const mockVaaWithCLZero = {
          ...mockBaseVaa,
          consistencyLevel: 0,
        };
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
        mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);
        mockWormholeMessageId = {
          chain: actualChainIdToChain(ETHEREUM_CHAIN_ID),
          emitter: new ActualUniversalAddress(EMITTER_ADDRESS_STR),
          sequence: BigInt(1),
        };
        mockChainContext.parseTransaction.mockResolvedValue([mockWormholeMessageId]);
        mockTokenBridgeOperations.isTransferCompleted.mockResolvedValue(true);
      });

      test('Should return null if VAA protocolName is not TokenBridge', async () => {
        const vaaWithWrongProtocol = createMockVaa(
          L2_TX_HASH,
          EMITTER_ADDRESS_STR,
          ETHEREUM_CHAIN_ID,
          {
            protocolName: 'AnotherProtocol' as any,
          },
        );
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
        const vaaWithWrongPayloadName = createMockVaa(
          L2_TX_HASH,
          EMITTER_ADDRESS_STR,
          ETHEREUM_CHAIN_ID,
          {
            payloadName: 'SomeOtherPayload' as any,
            payloadLiteral: 'TokenBridge:SomeOtherPayload' as any,
          },
        );
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

    describe(' transfer completion issues', () => {
      const getTokenBridgeError = new Error('Failed to get L1 Token Bridge');
      const isTransferCompletedError = new Error('isTransferCompleted exploded');

      const testCases = [
        {
          description:
            'should return null if tokenBridge.isTransferCompleted() returns false on L1',
          setupL1Mocks: (
            l1ChainCtx: typeof mockChainContext,
            l1TokenBridgeOps: typeof mockTokenBridgeOperations,
          ) => {
            l1TokenBridgeOps.isTransferCompleted.mockResolvedValue(false);
            mockWormholeInstance.getChain.mockImplementation((chainOrChainId) => {
              if (
                chainOrChainId === ARBITRUM_CHAIN_ID ||
                actualChainIdToChain(ARBITRUM_CHAIN_ID) === chainOrChainId
              ) {
                const configuredL1Context = {
                  ...l1ChainCtx,
                  getTokenBridge: jest
                    .fn<() => Promise<typeof mockTokenBridgeOperations>>()
                    .mockResolvedValue(l1TokenBridgeOps),
                };
                return configuredL1Context;
              }
              return mockChainContext;
            });
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
            l1TokenBridgeOps: typeof mockTokenBridgeOperations,
          ) => {
            const throwingL1ChainContext = {
              ...l1ChainCtx,
              getTokenBridge: jest
                .fn<() => Promise<typeof mockTokenBridgeOperations>>()
                .mockRejectedValue(getTokenBridgeError),
            };
            mockWormholeInstance.getChain.mockImplementation((chainOrChainId) => {
              if (
                chainOrChainId === ARBITRUM_CHAIN_ID ||
                actualChainIdToChain(ARBITRUM_CHAIN_ID) === chainOrChainId
              ) {
                return throwingL1ChainContext;
              }
              return mockChainContext;
            });
          },
          expectedLogMessage: 'Error checking VAA completion on L1',
          expectedErrorObject: getTokenBridgeError,
        },
        {
          description: 'should return null if L1 tokenBridge.isTransferCompleted() throws an error',
          setupL1Mocks: (
            l1ChainCtx: typeof mockChainContext,
            l1TokenBridgeOps: typeof mockTokenBridgeOperations,
          ) => {
            l1TokenBridgeOps.isTransferCompleted.mockRejectedValue(isTransferCompletedError);
            const l1ChainContextResolvingToThrowingOps = {
              ...l1ChainCtx,
              getTokenBridge: jest
                .fn<() => Promise<typeof mockTokenBridgeOperations>>()
                .mockResolvedValue(l1TokenBridgeOps),
            };
            mockWormholeInstance.getChain.mockImplementation((chainOrChainId) => {
              if (
                chainOrChainId === ARBITRUM_CHAIN_ID ||
                actualChainIdToChain(ARBITRUM_CHAIN_ID) === chainOrChainId
              ) {
                return l1ChainContextResolvingToThrowingOps;
              }
              return mockChainContext;
            });
          },
          expectedLogMessage: 'Error checking VAA completion on L1',
          expectedErrorObject: isTransferCompletedError,
        },
      ];

      test.each(testCases)(
        '$description',
        async ({ setupL1Mocks, expectedLogMessage, expectedErrorObject }) => {
          const mockReceipt = createMockReceipt(1, L2_TX_HASH);
          mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);
          const mockEmitterUAddress = new ActualUniversalAddress(EMITTER_ADDRESS_STR);
          const mockWormholeMessageId: WormholeMessageId = {
            chain: actualChainIdToChain(ETHEREUM_CHAIN_ID),
            emitter: mockEmitterUAddress,
            sequence: BigInt(1),
          };
          mockChainContext.parseTransaction.mockResolvedValue([mockWormholeMessageId]);
          const baseVaa = createMockVaa(L2_TX_HASH, EMITTER_ADDRESS_STR, ETHEREUM_CHAIN_ID);
          mockGetVaaImplementation.mockResolvedValue(
            baseVaa as VAA<'TokenBridge:TransferWithPayload'>,
          );

          const defaultL1TokenBridgeOps: typeof mockTokenBridgeOperations = {
            isTransferCompleted: jest
              .fn<(vaa: VAA<any>) => Promise<boolean>>()
              .mockResolvedValue(true),
          };
          const defaultL1ChainContext: typeof mockChainContext = {
            parseTransaction: jest
              .fn<(txHash: string) => Promise<WormholeMessageId[]>>()
              .mockResolvedValue([]),
            getTokenBridge: jest
              .fn<() => Promise<typeof mockTokenBridgeOperations>>()
              .mockResolvedValue(defaultL1TokenBridgeOps),
          };

          mockWormholeInstance.getChain.mockImplementation((chainOrChainId) => {
            if (
              chainOrChainId === ETHEREUM_CHAIN_ID ||
              actualChainIdToChain(ETHEREUM_CHAIN_ID) === chainOrChainId
            ) {
              return mockChainContext;
            }
            if (
              chainOrChainId === ARBITRUM_CHAIN_ID ||
              actualChainIdToChain(ARBITRUM_CHAIN_ID) === chainOrChainId
            ) {
              return defaultL1ChainContext;
            }
            throw new Error(`Unexpected chain in getChain mock: ${chainOrChainId}`);
          });

          setupL1Mocks(defaultL1ChainContext, defaultL1TokenBridgeOps);

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
            const l1Chain = mockWormholeInstance.getChain(ARBITRUM_CHAIN_ID);
            const l1Bridge = await l1Chain.getTokenBridge();
            expect(l1Bridge.isTransferCompleted).toHaveBeenCalledWith(baseVaa);
          }
        },
      );
    });
  });
});
