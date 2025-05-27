process.env.USE_REAL_WORMHOLE_SERVICE = 'true'; // Signal global setup to NOT mock WormholeVaaService

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { WormholeVaaService } from '../../../services/WormholeVaaService';
import type { ethers as EthersNamespace } from 'ethers';
import { BigNumber as EthersBigNumber, providers as EthersProviders } from 'ethers';

import {
  wormhole as actualWormhole,
  Wormhole as ActualWormholeClass,
  UniversalAddress as ActualUniversalAddress,
  type Network,
  type ChainId,
  type WormholeMessageId,
  type Chain,
  type VAA as ActualVAA,
  toChainId as actualToChainId,
  type PayloadLiteral,
  chainIdToChain as actualChainIdToChainSDK,
} from '@wormhole-foundation/sdk';
import logger, { logErrorContext } from '../../../utils/Logger';
import { stringifyWithBigInt } from '../../../utils/Numbers';

const mockWormholeSdkFunctions = jest.requireMock('@wormhole-foundation/sdk') as {
  wormhole: jest.MockedFunction<typeof actualWormhole>;
  chainIdToChain: jest.MockedFunction<typeof actualChainIdToChainSDK>;
};

// Store the mocked JsonRpcProvider constructor for later use/assertion.
let MockedJsonRpcProviderConstructor: jest.Mock;

jest.mock('ethers', () => {
  const originalEthers = jest.requireActual('ethers') as typeof EthersNamespace;
  MockedJsonRpcProviderConstructor = jest.fn().mockImplementation(() => ({
    getTransactionReceipt:
      jest.fn<() => Promise<EthersNamespace.providers.TransactionReceipt | null>>(),
    getNetwork: jest.fn<() => Promise<EthersNamespace.providers.Network>>(),
  }));
  return {
    __esModule: true,
    BigNumber: originalEthers.BigNumber,
    providers: {
      ...originalEthers.providers,
      JsonRpcProvider: MockedJsonRpcProviderConstructor, // Use the stored mock constructor
    },
    utils: originalEthers.utils,
  };
});

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

const mockWormholeEntry = mockWormholeSdkFunctions.wormhole;
// const mockChainIdToChainEntry = mockWormholeSdkFunctions.chainIdToChain; // Not directly used, relies on global mock

const mockLogger = logger as jest.Mocked<typeof logger>;
const mockLogErrorContext = logErrorContext as jest.MockedFunction<typeof logErrorContext>;

const EXPECTED_GET_VAA_TIMEOUT_MS = 300000;

describe('WormholeVaaService', () => {
  const L2_RPC = 'http://localhost:8545';
  const TEST_NETWORK: Network = 'Testnet';

  type MockableVAA<T extends PayloadLiteral> = ActualVAA<T> & {
    serialize?: jest.Mock<() => Uint8Array>;
    bytes?: Uint8Array;
  };

  let mockGetVaaImplementation: jest.MockedFunction<
    <T extends PayloadLiteral>(
      id: WormholeMessageId,
      decodeAs: T,
      timeout?: number,
    ) => Promise<MockableVAA<T> | null>
  >;

  type MockTokenBridgeOperationsType = {
    isTransferCompleted: jest.MockedFunction<(vaa: ActualVAA<any>) => Promise<boolean>>;
  };

  type MockChainContextType = {
    parseTransaction: jest.MockedFunction<(txHash: string) => Promise<WormholeMessageId[]>>;
    getTokenBridge: jest.MockedFunction<() => Promise<MockTokenBridgeOperationsType>>;
  };

  let mockWormholeInstance: {
    getChain: jest.MockedFunction<(chain: Chain | ChainId) => MockChainContextType>;
    getVaa: typeof mockGetVaaImplementation;
  };

  let mockChainContext: MockChainContextType;
  let mockTokenBridgeOperations: MockTokenBridgeOperationsType;
  let mockL2Provider: jest.Mocked<EthersNamespace.providers.JsonRpcProvider>;

  const ETHEREUM_CHAIN_ID = actualToChainId('Ethereum');
  const ARBITRUM_CHAIN_ID = actualToChainId('Arbitrum');
  const SOLANA_CHAIN_ID = actualToChainId('Solana');
  const POLYGON_CHAIN_ID = actualToChainId('Polygon');

  const createMockReceipt = (
    status: number | undefined,
    hash: string,
  ): EthersNamespace.providers.TransactionReceipt => {
    const receipt = {
      to: '0xcontractaddress',
      from: '0xsenderaddress',
      contractAddress: null as string | null, // Explicitly type null
      transactionIndex: 1,
      gasUsed: EthersBigNumber.from('21000'),
      logsBloom: '0x' + '0'.repeat(512),
      blockHash: '0xblockhash' + Date.now(),
      transactionHash: hash,
      logs: [],
      blockNumber: 123,
      confirmations: 10,
      cumulativeGasUsed: EthersBigNumber.from('21000'),
      effectiveGasPrice: EthersBigNumber.from('1000000000'),
      byzantium: true,
      type: 0,
      status: status,
    } as EthersNamespace.providers.TransactionReceipt; // Cast to the full type
    return receipt;
  };

  const createMockVaa = (
    _L2_TX_HASH: string,
    EMITTER_ADDRESS_STR: string,
    EMITTER_CHAIN_ID_FOR_VAA: ChainId,
    overrides: Partial<MockableVAA<any>> = {},
  ): MockableVAA<any> => {
    const mockEmitterUAddress = new ActualUniversalAddress(EMITTER_ADDRESS_STR);
    const emitterChainName = actualChainIdToChainSDK(EMITTER_CHAIN_ID_FOR_VAA);
    const defaults: MockableVAA<any> = {
      emitterChain: emitterChainName,
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
      serialize: jest.fn<() => Uint8Array>().mockReturnValue(new Uint8Array([1, 2, 3])),
      bytes: new Uint8Array([1, 2, 3, 4, 5]),
    };
    const merged = { ...defaults, ...overrides };
    if (merged.payloadName === 'Transfer') {
      merged.payloadLiteral = 'TokenBridge:Transfer' as const;
    }
    return merged;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Ensure the stored mock constructor is reset for each test if needed, or rely on its new instance per call.
    MockedJsonRpcProviderConstructor.mockClear();

    mockL2Provider = new EthersProviders.JsonRpcProvider(
      L2_RPC,
    ) as jest.Mocked<EthersNamespace.providers.JsonRpcProvider>;
    // The above `new` call uses the MockedJsonRpcProviderConstructor from the jest.mock scope.
    // We can assert that it was called and then make our mockL2Provider instance (which is the result of that call)
    // behave as needed.
    expect(MockedJsonRpcProviderConstructor).toHaveBeenCalledWith(L2_RPC);

    // Configure methods on the instance returned by the mocked constructor
    (mockL2Provider.getNetwork as jest.Mock).mockResolvedValue({
      name: 'testnet',
      chainId: ETHEREUM_CHAIN_ID,
    } as EthersNamespace.providers.Network);
    (mockL2Provider.getTransactionReceipt as jest.Mock).mockResolvedValue(null);

    mockGetVaaImplementation = jest.fn();
    mockTokenBridgeOperations = {
      isTransferCompleted: jest.fn<(vaa: ActualVAA<any>) => Promise<boolean>>(),
    };
    mockChainContext = {
      parseTransaction: jest
        .fn<(txHash: string) => Promise<WormholeMessageId[]>>()
        .mockResolvedValue([]),
      getTokenBridge: jest
        .fn<() => Promise<MockTokenBridgeOperationsType>>()
        .mockResolvedValue(mockTokenBridgeOperations),
    };
    mockWormholeInstance = {
      getChain: jest
        .fn<(chain: Chain | ChainId) => MockChainContextType>()
        .mockReturnValue(mockChainContext),
      getVaa: mockGetVaaImplementation,
    };
    mockWormholeEntry.mockResolvedValue(
      mockWormholeInstance as unknown as ActualWormholeClass<Network>,
    );
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
    test('should allow custom platform modules', async () => {
      const mockPlatform1 = { name: 'MockPlatform1', load: () => {} };
      const mockPlatform2 = { name: 'MockPlatform2', load: () => {} };
      await WormholeVaaService.create(L2_RPC, 'Mainnet', [mockPlatform1, mockPlatform2]);
      expect(mockWormholeEntry).toHaveBeenCalledWith('Mainnet', [mockPlatform1, mockPlatform2]);
    });
  });

  describe('fetchAndVerifyVaaForL2Event', () => {
    const L2_TX_HASH = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const EMITTER_ADDRESS_STR = '0x000000000000000000000000000000000000dead';
    let service: WormholeVaaService;

    beforeEach(async () => {
      (mockL2Provider.getNetwork as jest.Mock).mockResolvedValue({
        name: actualChainIdToChainSDK(ETHEREUM_CHAIN_ID),
        chainId: ETHEREUM_CHAIN_ID,
      } as EthersNamespace.providers.Network);
      service = await WormholeVaaService.create(mockL2Provider, TEST_NETWORK);
    });

    describe('Successful VAA Fetch and Verification', () => {
      test('should successfully fetch, parse, verify, and return VAA (VAA with .bytes)', async () => {
        const mockReceipt = createMockReceipt(1, L2_TX_HASH);
        (mockL2Provider.getTransactionReceipt as jest.Mock).mockResolvedValue(mockReceipt);

        const mockEmitterUAddress = new ActualUniversalAddress(EMITTER_ADDRESS_STR);
        const mockWormholeMessageId: WormholeMessageId = {
          chain: actualChainIdToChainSDK(ETHEREUM_CHAIN_ID),
          emitter: mockEmitterUAddress,
          sequence: BigInt(1),
        };

        const specificEthChainContext: MockChainContextType = {
          parseTransaction: jest
            .fn<(txHash: string) => Promise<WormholeMessageId[]>>()
            .mockResolvedValue([mockWormholeMessageId]),
          getTokenBridge: jest
            .fn<() => Promise<MockTokenBridgeOperationsType>>()
            .mockResolvedValue(mockTokenBridgeOperations),
        };
        const specificArbChainContext: MockChainContextType = {
          parseTransaction: jest.fn().mockResolvedValue([]),
          getTokenBridge: jest.fn().mockResolvedValue({
            ...mockTokenBridgeOperations,
            isTransferCompleted: jest.fn().mockResolvedValue(true),
          }),
        };

        (
          mockWormholeInstance.getChain as jest.MockedFunction<typeof mockWormholeInstance.getChain>
        ).mockImplementation((chainOrId: Chain | ChainId) => {
          const chainName =
            typeof chainOrId === 'string'
              ? chainOrId
              : actualChainIdToChainSDK(chainOrId as ChainId);
          if (chainName === actualChainIdToChainSDK(ETHEREUM_CHAIN_ID))
            return specificEthChainContext;
          if (chainName === actualChainIdToChainSDK(ARBITRUM_CHAIN_ID))
            return specificArbChainContext;
          return mockChainContext;
        });

        const mockVaaBytes = new Uint8Array([1, 2, 3, 4, 5]);
        const mockParsedVaaWithBytes = createMockVaa(
          L2_TX_HASH,
          EMITTER_ADDRESS_STR,
          ETHEREUM_CHAIN_ID,
          {
            bytes: mockVaaBytes,
            sequence: BigInt(1),
            payload: {
              token: '0xTOKEN',
              amount: '100',
              toChain: ARBITRUM_CHAIN_ID,
              toAddress: '0xRECEIVER',
            },
          },
        );
        mockGetVaaImplementation.mockResolvedValue(mockParsedVaaWithBytes);

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
        expect(mockWormholeInstance.getChain).toHaveBeenCalledWith(
          actualChainIdToChainSDK(ETHEREUM_CHAIN_ID),
        );
        expect(specificEthChainContext.parseTransaction).toHaveBeenCalledWith(L2_TX_HASH);
        expect(mockGetVaaImplementation).toHaveBeenCalledWith(
          mockWormholeMessageId,
          'TokenBridge:TransferWithPayload',
          EXPECTED_GET_VAA_TIMEOUT_MS,
        );
        expect(mockWormholeInstance.getChain).toHaveBeenCalledWith(
          actualChainIdToChainSDK(ARBITRUM_CHAIN_ID),
        );

        const returnedArbContext = (mockWormholeInstance.getChain as jest.Mock).mock.results.find(
          (res: jest.MockResult<MockChainContextType>) =>
            res.type === 'return' && res.value === specificArbChainContext,
        );
        expect(returnedArbContext).toBeDefined();
        const l1BridgeFromArb = await specificArbChainContext.getTokenBridge();
        expect(l1BridgeFromArb.isTransferCompleted).toHaveBeenCalledWith(mockParsedVaaWithBytes);
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('VAA fetched and verified'),
        );
      });

      test('should successfully fetch VAA when VAA has .serialize() and first getVaa is null for TransferWithPayload', async () => {
        const mockReceipt = createMockReceipt(1, L2_TX_HASH);
        (mockL2Provider.getTransactionReceipt as jest.Mock).mockResolvedValue(mockReceipt);
        const mockEmitterUAddress = new ActualUniversalAddress(EMITTER_ADDRESS_STR);
        const mockWormholeMessageId: WormholeMessageId = {
          chain: actualChainIdToChainSDK(ETHEREUM_CHAIN_ID),
          emitter: mockEmitterUAddress,
          sequence: BigInt(1),
        };

        const specificEthChainContext: MockChainContextType = {
          parseTransaction: jest.fn().mockResolvedValue([mockWormholeMessageId]),
          getTokenBridge: jest.fn().mockResolvedValue(mockTokenBridgeOperations),
        };
        const specificArbChainContext: MockChainContextType = {
          parseTransaction: jest.fn().mockResolvedValue([]),
          getTokenBridge: jest.fn().mockResolvedValue({
            ...mockTokenBridgeOperations,
            isTransferCompleted: jest.fn().mockResolvedValue(true),
          }),
        };
        (
          mockWormholeInstance.getChain as jest.MockedFunction<typeof mockWormholeInstance.getChain>
        ).mockImplementation((chainOrId: Chain | ChainId) => {
          const chainName =
            typeof chainOrId === 'string'
              ? chainOrId
              : actualChainIdToChainSDK(chainOrId as ChainId);
          if (chainName === actualChainIdToChainSDK(ETHEREUM_CHAIN_ID))
            return specificEthChainContext;
          if (chainName === actualChainIdToChainSDK(ARBITRUM_CHAIN_ID))
            return specificArbChainContext;
          return mockChainContext;
        });

        const mockVaaBytesSerialized = new Uint8Array([5, 4, 3, 2, 1]);
        const mockParsedVaaForTransfer = createMockVaa(
          L2_TX_HASH,
          EMITTER_ADDRESS_STR,
          ETHEREUM_CHAIN_ID,
          {
            payloadName: 'Transfer',
            payloadLiteral: 'TokenBridge:Transfer',
            payload: { token: '0xTOKEN', amount: '100' },
            sequence: BigInt(1),
            serialize: jest.fn<() => Uint8Array>().mockReturnValue(mockVaaBytesSerialized),
            bytes: undefined,
          },
        );

        mockGetVaaImplementation.mockImplementation(
          async <T extends PayloadLiteral>(
            _id: WormholeMessageId,
            decodeAs: T,
            _timeout?: number,
          ): Promise<MockableVAA<T> | null> => {
            if (decodeAs === 'TokenBridge:TransferWithPayload') return null;
            if (decodeAs === 'TokenBridge:Transfer')
              return mockParsedVaaForTransfer as unknown as MockableVAA<T>;
            return null;
          },
        );

        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          ETHEREUM_CHAIN_ID,
          EMITTER_ADDRESS_STR,
          ARBITRUM_CHAIN_ID,
        );

        expect(result).not.toBeNull();
        expect(result?.vaaBytes).toEqual(mockVaaBytesSerialized);
        expect(result?.parsedVaa).toBe(mockParsedVaaForTransfer);
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
        expect(mockParsedVaaForTransfer.serialize).toHaveBeenCalled();
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('VAA fetched and verified'),
        );
      });
    });

    describe('L2 transaction issues', () => {
      test('should return null if getTransactionReceipt fails to return a receipt', async () => {
        (mockL2Provider.getTransactionReceipt as jest.Mock).mockResolvedValue(null);
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
        (mockL2Provider.getTransactionReceipt as jest.Mock).mockResolvedValue(mockRevertedReceipt);
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
        (mockL2Provider.getTransactionReceipt as jest.Mock).mockResolvedValue(mockReceipt);
      });

      test('Test 2.3.1: Should return null if parseTransaction returns no Wormhole messages', async () => {
        const specificEthChainContext: MockChainContextType = {
          ...mockChainContext,
          parseTransaction: jest.fn().mockResolvedValue([]),
        };
        (
          mockWormholeInstance.getChain as jest.MockedFunction<typeof mockWormholeInstance.getChain>
        ).mockImplementation((chainOrId: Chain | ChainId) => {
          const chainName =
            typeof chainOrId === 'string'
              ? chainOrId
              : actualChainIdToChainSDK(chainOrId as ChainId);
          if (chainName === actualChainIdToChainSDK(ETHEREUM_CHAIN_ID))
            return specificEthChainContext;
          return mockChainContext;
        });
        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          ETHEREUM_CHAIN_ID,
          EMITTER_ADDRESS_STR,
          ARBITRUM_CHAIN_ID,
        );
        expect(result).toBeNull();
        expect(specificEthChainContext.parseTransaction).toHaveBeenCalledWith(L2_TX_HASH);
        expect(mockLogErrorContext).toHaveBeenCalledWith(
          expect.stringContaining(`No Wormhole messages found in L2 transaction ${L2_TX_HASH}`),
          expect.objectContaining({ message: 'parseTransaction returned no messages' }),
        );
      });

      test('should return null if no WormholeMessageId matches the emitter address and chain', async () => {
        const nonMatchingEmitterAddressStr = '0x1111111111111111111111111111111111111111';
        const mockMsgNonMatchingEmitter: WormholeMessageId = {
          chain: actualChainIdToChainSDK(ETHEREUM_CHAIN_ID),
          emitter: new ActualUniversalAddress(nonMatchingEmitterAddressStr),
          sequence: BigInt(1),
        };
        const mockMsgNonMatchingChain: WormholeMessageId = {
          chain: actualChainIdToChainSDK(POLYGON_CHAIN_ID),
          emitter: new ActualUniversalAddress(EMITTER_ADDRESS_STR),
          sequence: BigInt(2),
        };
        const specificEthChainContext: MockChainContextType = {
          ...mockChainContext,
          parseTransaction: jest
            .fn()
            .mockResolvedValue([mockMsgNonMatchingEmitter, mockMsgNonMatchingChain]),
        };
        (
          mockWormholeInstance.getChain as jest.MockedFunction<typeof mockWormholeInstance.getChain>
        ).mockImplementation((chainOrId: Chain | ChainId) => {
          const chainName =
            typeof chainOrId === 'string'
              ? chainOrId
              : actualChainIdToChainSDK(chainOrId as ChainId);
          if (chainName === actualChainIdToChainSDK(ETHEREUM_CHAIN_ID))
            return specificEthChainContext;
          return mockChainContext;
        });
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
        (mockL2Provider.getTransactionReceipt as jest.Mock).mockResolvedValue(mockReceipt);
        mockWormholeMessageId = {
          chain: actualChainIdToChainSDK(ETHEREUM_CHAIN_ID),
          emitter: new ActualUniversalAddress(EMITTER_ADDRESS_STR),
          sequence: BigInt(1),
        };
        const specificEthChainContext: MockChainContextType = {
          ...mockChainContext,
          parseTransaction: jest.fn().mockResolvedValue([mockWormholeMessageId]),
        };
        const specificArbChainContext: MockChainContextType = {
          ...mockChainContext,
          getTokenBridge: jest.fn().mockResolvedValue({
            ...mockTokenBridgeOperations,
            isTransferCompleted: jest.fn().mockResolvedValue(true),
          }),
        };
        (
          mockWormholeInstance.getChain as jest.MockedFunction<typeof mockWormholeInstance.getChain>
        ).mockImplementation((chainOrId: Chain | ChainId) => {
          const chainName =
            typeof chainOrId === 'string'
              ? chainOrId
              : actualChainIdToChainSDK(chainOrId as ChainId);
          if (chainName === actualChainIdToChainSDK(ETHEREUM_CHAIN_ID))
            return specificEthChainContext;
          if (chainName === actualChainIdToChainSDK(ARBITRUM_CHAIN_ID))
            return specificArbChainContext;
          return mockChainContext;
        });
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
        const relevantLogErrorCall = mockLogErrorContext.mock.calls.find((call) =>
          call[0].includes('this.wh.getVaa did not return a VAA for message ID'),
        );
        expect(relevantLogErrorCall).toBeDefined();
        expect(relevantLogErrorCall![0]).toContain(`Last error: ${getVaaError.message}`);
        expect(relevantLogErrorCall![1]).toMatchObject({
          message: 'this.wh.getVaa failed or returned null VAA after all retries',
        });
        expect(stringifyWithBigInt((relevantLogErrorCall![1] as any).messageId)).toEqual(
          stringifyWithBigInt(mockWormholeMessageId),
        );
        expect((relevantLogErrorCall![1] as any).lastError).toEqual(getVaaError.message);
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
        expect(mockGetVaaImplementation).toHaveBeenCalledTimes(2);
        const relevantLogErrorCall = mockLogErrorContext.mock.calls.find((call) =>
          call[0].includes('this.wh.getVaa did not return a VAA for message ID'),
        );
        expect(relevantLogErrorCall).toBeDefined();
        expect(relevantLogErrorCall![0]).toContain(
          'Last error: VAA not found with this discriminator',
        );
        expect(relevantLogErrorCall![1]).toMatchObject({
          message: 'this.wh.getVaa failed or returned null VAA after all retries',
        });
        expect(stringifyWithBigInt((relevantLogErrorCall![1] as any).messageId)).toEqual(
          stringifyWithBigInt(mockWormholeMessageId),
        );
        expect((relevantLogErrorCall![1] as any).lastError).toEqual(
          'VAA not found with this discriminator.',
        );
      });
    });

    describe('initial VAA verification failures', () => {
      let mockBaseVaaWithoutBytes: Omit<MockableVAA<'TokenBridge:TransferWithPayload'>, 'bytes'>;
      let mockEmitterUAddress: ActualUniversalAddress;
      beforeEach(() => {
        const mockReceipt = createMockReceipt(1, L2_TX_HASH);
        (mockL2Provider.getTransactionReceipt as jest.Mock).mockResolvedValue(mockReceipt);
        mockEmitterUAddress = new ActualUniversalAddress(EMITTER_ADDRESS_STR);
        const mockWormholeMessageId: WormholeMessageId = {
          chain: actualChainIdToChainSDK(ETHEREUM_CHAIN_ID),
          emitter: mockEmitterUAddress,
          sequence: BigInt(1),
        };
        const specificEthChainContext: MockChainContextType = {
          ...mockChainContext,
          parseTransaction: jest.fn().mockResolvedValue([mockWormholeMessageId]),
        };
        const specificArbChainContext: MockChainContextType = {
          ...mockChainContext,
          getTokenBridge: jest.fn().mockResolvedValue({
            ...mockTokenBridgeOperations,
            isTransferCompleted: jest.fn().mockResolvedValue(true),
          }),
        };
        (
          mockWormholeInstance.getChain as jest.MockedFunction<typeof mockWormholeInstance.getChain>
        ).mockImplementation((chainOrId: Chain | ChainId) => {
          const chainName =
            typeof chainOrId === 'string'
              ? chainOrId
              : actualChainIdToChainSDK(chainOrId as ChainId);
          if (chainName === actualChainIdToChainSDK(ETHEREUM_CHAIN_ID))
            return specificEthChainContext;
          if (chainName === actualChainIdToChainSDK(ARBITRUM_CHAIN_ID))
            return specificArbChainContext;
          return mockChainContext;
        });
        mockBaseVaaWithoutBytes = {
          emitterChain: actualChainIdToChainSDK(ETHEREUM_CHAIN_ID),
          emitterAddress: mockEmitterUAddress,
          sequence: BigInt(1),
          consistencyLevel: 15,
          protocolName: 'TokenBridge',
          payloadName: 'TransferWithPayload',
          payloadLiteral: 'TokenBridge:TransferWithPayload',
          payload: { data: 'some payload' } as any,
          serialize: jest.fn<() => Uint8Array>().mockReturnValue(new Uint8Array([1, 2, 3])),
          guardianSet: 0,
          timestamp: Math.floor(Date.now() / 1000),
          nonce: 0,
          signatures: [] as any[],
          hash: new Uint8Array(32).fill(3),
        };
        mockGetVaaImplementation.mockResolvedValue(
          mockBaseVaaWithoutBytes as MockableVAA<'TokenBridge:TransferWithPayload'>,
        );
      });

      test('should return null if VAA emitterChain mismatch', async () => {
        const mismatchedParsedVaa = {
          ...mockBaseVaaWithoutBytes,
          emitterChain: actualChainIdToChainSDK(SOLANA_CHAIN_ID),
        };
        mockGetVaaImplementation.mockResolvedValue(
          mismatchedParsedVaa as MockableVAA<'TokenBridge:TransferWithPayload'>,
        );
        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          ETHEREUM_CHAIN_ID,
          EMITTER_ADDRESS_STR,
          ARBITRUM_CHAIN_ID,
        );
        expect(result).toBeNull();
        const logCall = mockLogErrorContext.mock.calls.find((c) =>
          c[0].includes('Initial VAA verification (emitter check) failed'),
        );
        expect(logCall).toBeDefined();
        expect(logCall![1]).toMatchObject({ message: 'Initial VAA verification failed' });
      });
      test('should return null if VAA emitterAddress mismatch', async () => {
        const wrongEmitterAddressStr = '0xbad0000000000000000000000000000000000bad';
        const mismatchedEmitterAddressVaa = {
          ...mockBaseVaaWithoutBytes,
          emitterAddress: new ActualUniversalAddress(wrongEmitterAddressStr),
        };
        mockGetVaaImplementation.mockResolvedValue(
          mismatchedEmitterAddressVaa as MockableVAA<'TokenBridge:TransferWithPayload'>,
        );
        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          ETHEREUM_CHAIN_ID,
          EMITTER_ADDRESS_STR,
          ARBITRUM_CHAIN_ID,
        );
        expect(result).toBeNull();
        const logCall = mockLogErrorContext.mock.calls.find((c) =>
          c[0].includes('Initial VAA verification (emitter check) failed'),
        );
        expect(logCall).toBeDefined();
        expect(logCall![1]).toMatchObject({ message: 'Initial VAA verification failed' });
      });
      test('low consistency level (matching MIN_VAA_CONSISTENCY_LEVEL) should log warning but pass verification if other checks are ok', async () => {
        const lowConsistencyVaa = { ...mockBaseVaaWithoutBytes, consistencyLevel: 1 };
        mockGetVaaImplementation.mockResolvedValue(
          lowConsistencyVaa as MockableVAA<'TokenBridge:TransferWithPayload'>,
        );
        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          ETHEREUM_CHAIN_ID,
          EMITTER_ADDRESS_STR,
          ARBITRUM_CHAIN_ID,
        );
        expect(result).not.toBeNull();
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(
            `VAA verification warning: Low consistency level. Expected 1, Got: 1`,
          ),
        );
        const errorLogCalls = mockLogErrorContext.mock.calls.filter((c) =>
          c[0].includes('Initial VAA verification (emitter check) failed'),
        );
        expect(errorLogCalls.length).toBe(0);
      });
      test('VAA with consistency level 0 should pass verification and not log MIN_VAA_CONSISTENCY_LEVEL warning', async () => {
        const mockVaaWithCLZero = { ...mockBaseVaaWithoutBytes, consistencyLevel: 0 };
        mockGetVaaImplementation.mockResolvedValue(
          mockVaaWithCLZero as MockableVAA<'TokenBridge:TransferWithPayload'>,
        );
        const result = await service.fetchAndVerifyVaaForL2Event(
          L2_TX_HASH,
          ETHEREUM_CHAIN_ID,
          EMITTER_ADDRESS_STR,
          ARBITRUM_CHAIN_ID,
        );
        expect(result).not.toBeNull();
        const warnCalls = mockLogger.warn.mock.calls;
        const consistencyWarningPatternForLevel1 =
          /VAA verification warning: Low consistency level. Expected.*1, Got: 0/;
        for (const call of warnCalls) {
          if (call[0].includes('Low consistency level')) {
            expect(call[0]).not.toMatch(consistencyWarningPatternForLevel1);
          }
        }
        const errorLogCalls = mockLogErrorContext.mock.calls.filter((c) =>
          c[0].includes('Initial VAA verification (emitter check) failed'),
        );
        expect(errorLogCalls.length).toBe(0);
      });
    });

    describe('VAA content verification failures', () => {
      beforeEach(() => {
        const mockWormholeMessageIdForContentTests: WormholeMessageId = {
          chain: actualChainIdToChainSDK(ETHEREUM_CHAIN_ID),
          emitter: new ActualUniversalAddress(EMITTER_ADDRESS_STR),
          sequence: BigInt(1),
        };
        const specificEthChainContext: MockChainContextType = {
          ...mockChainContext,
          parseTransaction: jest.fn().mockResolvedValue([mockWormholeMessageIdForContentTests]),
        };
        const specificArbChainContext: MockChainContextType = {
          ...mockChainContext,
          getTokenBridge: jest.fn().mockResolvedValue({
            ...mockTokenBridgeOperations,
            isTransferCompleted: jest.fn().mockResolvedValue(true),
          }),
        };
        (
          mockWormholeInstance.getChain as jest.MockedFunction<typeof mockWormholeInstance.getChain>
        ).mockImplementation((chainOrId: Chain | ChainId) => {
          const chainName =
            typeof chainOrId === 'string'
              ? chainOrId
              : actualChainIdToChainSDK(chainOrId as ChainId);
          if (chainName === actualChainIdToChainSDK(ETHEREUM_CHAIN_ID))
            return specificEthChainContext;
          if (chainName === actualChainIdToChainSDK(ARBITRUM_CHAIN_ID))
            return specificArbChainContext;
          return mockChainContext;
        });
      });
      test('Should return null if VAA protocolName is not TokenBridge', async () => {
        const vaaWithWrongProtocol = createMockVaa(
          L2_TX_HASH,
          EMITTER_ADDRESS_STR,
          ETHEREUM_CHAIN_ID,
          {
            protocolName: 'AnotherProtocol' as any,
            sequence: BigInt(1),
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
        const logCall = mockLogErrorContext.mock.calls.find((c) =>
          c[0].includes('VAA verification failed: Protocol name mismatch'),
        );
        expect(logCall).toBeDefined();
        expect(logCall![1]).toMatchObject({ message: 'VAA protocol name mismatch' });
      });
      test('should return null if VAA payloadName is not Transfer or TransferWithPayload', async () => {
        const vaaWithWrongPayloadName = createMockVaa(
          L2_TX_HASH,
          EMITTER_ADDRESS_STR,
          ETHEREUM_CHAIN_ID,
          {
            payloadName: 'SomeOtherPayload' as any,
            payloadLiteral: 'TokenBridge:SomeOtherPayload' as any,
            sequence: BigInt(1),
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
        const logCall = mockLogErrorContext.mock.calls.find((c) =>
          c[0].includes('VAA verification failed: Payload name mismatch'),
        );
        expect(logCall).toBeDefined();
        expect(logCall![1]).toMatchObject({ message: 'VAA payload name mismatch' });
      });
    });

    describe('transfer completion issues', () => {
      const getTokenBridgeError = new Error('Failed to get L1 Token Bridge');
      const isTransferCompletedError = new Error('isTransferCompleted exploded');
      type TransferCompletionTestCase = {
        customDescription: string;
        setupL1Mocks: (testSpecificMsgId: WormholeMessageId) => void;
        expectedLogMessage: string;
        expectedErrorObject: any;
      };

      const testCases: TransferCompletionTestCase[] = [
        {
          customDescription:
            'should return null if tokenBridge.isTransferCompleted() returns false on L1',
          setupL1Mocks: (testSpecificMsgId: WormholeMessageId) => {
            (
              mockWormholeInstance.getChain as jest.MockedFunction<
                typeof mockWormholeInstance.getChain
              >
            ).mockImplementation((chainOrId: Chain | ChainId) => {
              const chainName =
                typeof chainOrId === 'string'
                  ? chainOrId
                  : actualChainIdToChainSDK(chainOrId as ChainId);
              if (chainName === actualChainIdToChainSDK(ETHEREUM_CHAIN_ID)) {
                return {
                  ...mockChainContext,
                  parseTransaction: jest.fn().mockResolvedValue([testSpecificMsgId]),
                };
              }
              if (chainName === actualChainIdToChainSDK(ARBITRUM_CHAIN_ID)) {
                return {
                  ...mockChainContext,
                  getTokenBridge: jest.fn().mockResolvedValue({
                    ...mockTokenBridgeOperations,
                    isTransferCompleted: jest.fn().mockResolvedValue(false),
                  }),
                };
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
          customDescription:
            'should return null if l1ChainContext.getTokenBridge() throws an error',
          setupL1Mocks: (testSpecificMsgId: WormholeMessageId) => {
            (
              mockWormholeInstance.getChain as jest.MockedFunction<
                typeof mockWormholeInstance.getChain
              >
            ).mockImplementation((chainOrId: Chain | ChainId) => {
              const chainName =
                typeof chainOrId === 'string'
                  ? chainOrId
                  : actualChainIdToChainSDK(chainOrId as ChainId);
              if (chainName === actualChainIdToChainSDK(ETHEREUM_CHAIN_ID)) {
                return {
                  ...mockChainContext,
                  parseTransaction: jest.fn().mockResolvedValue([testSpecificMsgId]),
                };
              }
              if (chainName === actualChainIdToChainSDK(ARBITRUM_CHAIN_ID)) {
                return {
                  ...mockChainContext,
                  getTokenBridge: jest.fn().mockRejectedValue(getTokenBridgeError),
                };
              }
              return mockChainContext;
            });
          },
          expectedLogMessage:
            'Error checking VAA completion on L1: Failed to get token bridge for L1 chain',
          expectedErrorObject: expect.objectContaining({ message: getTokenBridgeError.message }),
        },
        {
          customDescription:
            'should return null if L1 tokenBridge.isTransferCompleted() throws an error',
          setupL1Mocks: (testSpecificMsgId: WormholeMessageId) => {
            (
              mockWormholeInstance.getChain as jest.MockedFunction<
                typeof mockWormholeInstance.getChain
              >
            ).mockImplementation((chainOrId: Chain | ChainId) => {
              const chainName =
                typeof chainOrId === 'string'
                  ? chainOrId
                  : actualChainIdToChainSDK(chainOrId as ChainId);
              if (chainName === actualChainIdToChainSDK(ETHEREUM_CHAIN_ID)) {
                return {
                  ...mockChainContext,
                  parseTransaction: jest.fn().mockResolvedValue([testSpecificMsgId]),
                };
              }
              if (chainName === actualChainIdToChainSDK(ARBITRUM_CHAIN_ID)) {
                return {
                  ...mockChainContext,
                  getTokenBridge: jest.fn().mockResolvedValue({
                    ...mockTokenBridgeOperations,
                    isTransferCompleted: jest.fn().mockRejectedValue(isTransferCompletedError),
                  }),
                };
              }
              return mockChainContext;
            });
          },
          expectedLogMessage:
            'Error checking VAA completion on L1: isTransferCompleted failed for L1 chain',
          expectedErrorObject: expect.objectContaining({
            message: isTransferCompletedError.message,
          }),
        },
      ];

      test.each(testCases)(
        '$customDescription',
        async ({ setupL1Mocks, expectedLogMessage, expectedErrorObject }) => {
          const mockReceipt = createMockReceipt(1, L2_TX_HASH);
          (mockL2Provider.getTransactionReceipt as jest.Mock).mockResolvedValue(mockReceipt);
          const mockEmitterUAddress = new ActualUniversalAddress(EMITTER_ADDRESS_STR);
          const commonMockWormholeMessageId: WormholeMessageId = {
            chain: actualChainIdToChainSDK(ETHEREUM_CHAIN_ID),
            emitter: mockEmitterUAddress,
            sequence: BigInt(1),
          };

          setupL1Mocks(commonMockWormholeMessageId);

          const baseVaa = createMockVaa(L2_TX_HASH, EMITTER_ADDRESS_STR, ETHEREUM_CHAIN_ID, {
            sequence: BigInt(1),
          });
          mockGetVaaImplementation.mockResolvedValue(
            baseVaa as MockableVAA<'TokenBridge:TransferWithPayload'>,
          );

          const result = await service.fetchAndVerifyVaaForL2Event(
            L2_TX_HASH,
            ETHEREUM_CHAIN_ID,
            EMITTER_ADDRESS_STR,
            ARBITRUM_CHAIN_ID,
          );

          expect(result).toBeNull();
          const logErrorCall = mockLogErrorContext.mock.calls.find((call) =>
            call[0].includes(expectedLogMessage),
          );
          expect(logErrorCall).toBeDefined();
          expect(logErrorCall![1]).toMatchObject(expectedErrorObject);

          if (
            expectedLogMessage.includes('Token bridge transfer VAA not completed on L1') ||
            expectedLogMessage.includes('isTransferCompleted failed for L1 chain')
          ) {
            const getChainCallForL1 = (mockWormholeInstance.getChain as jest.Mock).mock.calls.find(
              (call) => {
                const arg = call[0];
                const cName =
                  typeof arg === 'string' ? arg : actualChainIdToChainSDK(arg as ChainId);
                return cName === actualChainIdToChainSDK(ARBITRUM_CHAIN_ID);
              },
            );
            expect(getChainCallForL1).toBeDefined();
            const l1ChainContextReturned = (
              mockWormholeInstance.getChain as jest.Mock
            ).mock.results.find((r: jest.MockResult<MockChainContextType>) => {
              const callArgs = (mockWormholeInstance.getChain as jest.Mock).mock.calls[
                (mockWormholeInstance.getChain as jest.Mock).mock.results.indexOf(r)
              ][0];
              const cName =
                typeof callArgs === 'string'
                  ? callArgs
                  : actualChainIdToChainSDK(callArgs as ChainId);
              return cName === actualChainIdToChainSDK(ARBITRUM_CHAIN_ID);
            })?.value;

            if (l1ChainContextReturned && l1ChainContextReturned.getTokenBridge) {
              const l1Bridge = await l1ChainContextReturned.getTokenBridge();
              if (
                l1Bridge.isTransferCompleted &&
                (expectedLogMessage.includes('isTransferCompleted failed for L1 chain') ||
                  expectedLogMessage.includes('Token bridge transfer VAA not completed on L1'))
              ) {
                expect(l1Bridge.isTransferCompleted).toHaveBeenCalledWith(baseVaa);
              }
            } else if (!expectedLogMessage.includes('Failed to get token bridge for L1 chain')) {
              // console.warn(
              //   `L1 chain context or getTokenBridge not found/called as expected for ARBITRUM_CHAIN_ID in test: ${_testDescriptionForLog}`
              // );
            }
          }
        },
      );
    });
  });
});
