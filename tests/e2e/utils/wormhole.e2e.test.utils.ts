import { jest } from '@jest/globals';
import {
  type ChainId,
  type Network,
  type VAA,
  type WormholeMessageId,
  chainIdToChain as actualChainIdToChain,
  UniversalAddress as ActualUniversalAddress,
  type Chain,
  type PayloadLiteral,
  wormhole,
  // Wormhole, // Not directly used as a type here, instance is through mockWormholeInstance
  // toChainId, // Not directly used here
  TokenBridge, // Potentially for typing L1TokenBridgeOperations if needed
} from '@wormhole-foundation/sdk';
import { ethers } from 'ethers'; // This will be the mocked ethers
import logger, { logErrorContext } from '../../../utils/Logger.js';
import {
  type TestScenario,
  // L2_CHAIN_ID_SUI, // Not directly used in this file, but by tests
  // L2_CHAIN_ID_AVAX, // Not directly used in this file, but by tests
} from '../../data/wormhole.e2e.scenarios';
import { WormholeVaaService } from '../../../services/WormholeVaaService.js';

// --- mockWormholeInstance DEFINITION (MOVED UP) ---
// This structure defines what our `wormhole()` mock function will return.
const mockWormholeInstance = {
  getChain: jest.fn<(chain: Chain | ChainId) => any>(), // Type will be InferredChainContext
  getVaa: jest.fn<any>(), // This will be assigned mockGetVaaSdkImplementation in setup
  // Add other methods of Wormhole class if they are directly called by WormholeVaaService
};

// Determine ChainContext type dynamically from the mock's getChain method
type InferredChainContext = ReturnType<typeof mockWormholeInstance.getChain>;

// --- Global Constants for mocks ---
export const EXPECTED_GET_VAA_TIMEOUT_MS = 5000;
export const DEFAULT_PAYLOAD_LITERAL = 'TokenBridge:TransferWithPayload';
export const EXAMPLE_EMITTER_ADDRESS_SUI = '0x00000000000000000000000000000000000000000000000000000000deadbeef';
export const EXAMPLE_SEQUENCE = BigInt(123);

// --- Global Mock Variables (Typed) ---
// These are assigned within setupWormholeMocksAndService
export let mockWormholeEntry: jest.MockedFunction<typeof wormhole>;
export let mockL2Provider: MockedEthersProvider;
export let mockL1Provider: MockedEthersProvider;
export let mockL2ChainContext: jest.Mocked<InferredChainContext>;
export let mockL1ChainContext: jest.Mocked<InferredChainContext>;
export let mockL1TokenBridgeOperations: {
  isTransferCompleted: jest.Mock<(vaa: VAA<any>) => Promise<boolean>>;
  // Add other TokenBridge operations if needed
};
export let mockLogger: jest.Mocked<typeof logger>;
export let mockLogErrorContext: jest.MockedFunction<typeof logErrorContext>;
export let mockGetVaaSdkImplementation: jest.Mock<
  <T extends PayloadLiteral>(
    id: WormholeMessageId,
    decodeAs: T,
    timeout?: number,
  ) => Promise<VAA<T> | null>
>;
// These were for direct mocking of SDK utils, now SDK mock provides actuals for these
// export const mockChainIdToChainFn = jest.fn<typeof actualChainIdToChain>();
// export const mockUniversalAddressConstructorFn =
//   jest.fn<(address: string | Uint8Array) => ActualUniversalAddress>();

// --- Mock Instance Types (for return type of setup function) ---
export interface MockedWormholeInstances {
  wormholeVaaService: WormholeVaaService;
  mockWormholeEntry: jest.MockedFunction<typeof wormhole>;
  mockL2Provider: MockedEthersProvider;
  mockL1Provider: MockedEthersProvider;
  mockL2ChainContext: jest.Mocked<InferredChainContext>;
  mockL1ChainContext: jest.Mocked<InferredChainContext>;
  mockL1TokenBridgeOperations: {
    isTransferCompleted: jest.Mock<(vaa: VAA<any>) => Promise<boolean>>;
  };
  mockLogger: jest.Mocked<typeof logger>;
  mockLogErrorContext: jest.MockedFunction<typeof logErrorContext>;
  mockGetVaaSdkImplementation: jest.Mock<
    <T extends PayloadLiteral>(
      id: WormholeMessageId,
      decodeAs: T,
      timeout?: number,
    ) => Promise<VAA<T> | null>
  >;
  mockWormholeInstance: typeof mockWormholeInstance; // Expose the core mock instance
}

// --- SDK and Ethers Mocks ---

// Mock for @wormhole-foundation/sdk
jest.mock('@wormhole-foundation/sdk', () => {
  const originalSdk = jest.requireActual('@wormhole-foundation/sdk') as any;
  return {
    __esModule: true,
    Wormhole: originalSdk.Wormhole, // Actual class for type hints / instanceof
    UniversalAddress: originalSdk.UniversalAddress, // Use actual constructor
    chainIdToChain: originalSdk.chainIdToChain, // Use actual utility
    wormhole: jest.fn(() => mockWormholeInstance), // Our main mock for the `wormhole()` entry point
    Network: originalSdk.Network, // Export enums/constants if needed
    Chain: originalSdk.Chain,
    toChainId: originalSdk.toChainId,
    TokenBridge: originalSdk.TokenBridge, // For typing L1TokenBridgeOperations
    ethers_contracts: originalSdk.ethers_contracts, // Preserve if used by TokenBridge or other parts
    // Add other exports from SDK if they are directly used by the service and need to be actuals or mocked.
  };
});

// Mock for ethers
jest.mock('ethers', () => {
  const originalEthers = jest.requireActual('ethers') as typeof ethers; // Cast to typeof ethers for type safety

  // Define the type for our mock JsonRpcProvider instance methods
  type MockJsonRpcProviderInstanceMethods = {
    getTransactionReceipt: jest.Mock<() => Promise<ethers.providers.TransactionReceipt | null>>;
    getNetwork: jest.Mock<() => Promise<ethers.providers.Network>>;
    // Add other methods of JsonRpcProvider instance if called by the service
  };

  // This is the mock for the JsonRpcProvider class constructor
  const mockJsonRpcProviderConstructor = jest.fn(
    (rpcUrl: string): MockJsonRpcProviderInstanceMethods => {
      // console.log(`Mock JsonRpcProvider CONSTRUCTOR called for: ${rpcUrl}`);
      return {
        getTransactionReceipt: jest.fn<() => Promise<ethers.providers.TransactionReceipt | null>>(),
        getNetwork: jest
          .fn<() => Promise<ethers.providers.Network>>()
          .mockImplementation(async () => {
            // console.log(`Mock getNetwork called for provider with RPC: ${rpcUrl}`);
            return Promise.resolve<ethers.providers.Network>({
              name: rpcUrl.includes('sui')
                ? 'sui-mock'
                : rpcUrl.includes('avax')
                  ? 'avax-mock'
                  : 'eth-mock',
              chainId: rpcUrl.includes('sui') ? 21 : rpcUrl.includes('avax') ? 6 : 1,
            });
          }),
      };
    },
  );

  return {
    // Return an object that matches the structure of the 'ethers' module
    providers: {
      // Spread original providers if some are used directly and not mocked
      // ...originalEthers.providers,
      JsonRpcProvider: mockJsonRpcProviderConstructor, // Our mocked constructor
    },
    utils: {
      // Spread original utils or mock specific ones if needed
      ...originalEthers.utils,
      // Example: arrayify: jest.fn() if we wanted to mock it
    },
    BigNumber: originalEthers.BigNumber, // Essential for creating mock receipts, etc.
    Wallet: originalEthers.Wallet, // If used
    Contract: originalEthers.Contract, // If used
    // Add other ethers exports if they are used by the service or helper functions
  };
});

// Mock for Logger utility
jest.mock('../../../utils/Logger.js', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logErrorContext: jest.fn(),
}));

// --- Mock Creation Helpers ---

// ADD CORRECTED createMockEthersReceipt HERE
export function createMockEthersReceipt(
  txHash: string,
  status: number = 1, // Default to success
): ethers.providers.TransactionReceipt {
  const localEthers = jest.requireMock('ethers') as typeof ethers;
  return {
    to: '0xtoaddressmock',
    from: '0xfromaddressmock',
    contractAddress: '0xcontractaddressmock',
    transactionIndex: 1,
    gasUsed: localEthers.BigNumber.from('21000'),
    logsBloom: '0xlogsBloommMock',
    blockHash: '0xblockhashmock',
    blockNumber: 1234567,
    confirmations: 10,
    cumulativeGasUsed: localEthers.BigNumber.from('100000'),
    effectiveGasPrice: localEthers.BigNumber.from('10000000000'), // Example: 10 Gwei
    byzantium: true,
    type: 2, // EIP-1559 transaction type
    status: status, // 1 for success, 0 for failure
    logs: [], // Empty logs array for simplicity
    root: '0xrootmock', // Optional, depending on receipt type
    transactionHash: txHash, // Added missing transactionHash
    // Add any other fields your service might expect or that are mandatory
    // Ensure all fields expected by ethers.providers.TransactionReceipt are present
  };
}

// --- VAA Creation Helper ---

// Interface for VAA creation parameters
interface CreateMockSdkVaaParams<T extends PayloadLiteral> {
  emitterChain?: ChainId;
  emitterAddress?: string;
  sequence?: bigint | number;
  consistencyLevel?: number;
  guardianSet?: number;
  payloadLiteral?: T;
  timestamp?: number;
  nonce?: number;
  bytes?: Uint8Array; // Allow providing actual bytes
  serialize?: jest.Mock<() => Uint8Array>; // Allow providing actual serialize mock
}

// Helper to create VAA for tests
export function createMockSdkVaa<
  T extends PayloadLiteral = typeof DEFAULT_PAYLOAD_LITERAL,
>({
  emitterChain = 21 as ChainId, // Default to Sui L2 ChainId for SDK
  emitterAddress = EXAMPLE_EMITTER_ADDRESS_SUI,
  sequence = EXAMPLE_SEQUENCE,
  consistencyLevel = 0,
  guardianSet = 0,
  payloadLiteral = DEFAULT_PAYLOAD_LITERAL as T,
  timestamp = Math.floor(Date.now() / 1000),
  nonce = 0,
  bytes,
  serialize,
}: CreateMockSdkVaaParams<T> = {}): VAA<T> {
  const sequenceBigInt = BigInt(sequence);
  const protocolName = payloadLiteral.split(':')[0] as any; // ProtocolName type not directly available from SDK top
  const payloadNameStr = payloadLiteral.split(':')[1] as string;

  const actualEmitterAddress = new ActualUniversalAddress(emitterAddress);
  const actualEmitterChain = actualChainIdToChain(emitterChain);

  // Create a hash value (e.g. a 32-byte array filled with 1s)
  const mockHash = new Uint8Array(32).fill(1);

  return {
    version: 1,
    guardianSet,
    signatures: [],
    timestamp: timestamp,
    nonce: nonce,
    emitterChain: actualEmitterChain,
    emitterAddress: actualEmitterAddress,
    sequence: sequenceBigInt,
    consistencyLevel: consistencyLevel,
    protocolName: protocolName,
    payloadName: payloadNameStr,
    payloadLiteral: payloadLiteral,
    payload: { somePayloadData: 'data', anotherKey: 123 } as any, // Generic payload
    bytes: bytes ?? new Uint8Array([1, 2, 3, 4, 5]),
    serialize: serialize ?? jest.fn(() => new Uint8Array([1, 2, 3, 4, 5])),
    hash: mockHash, // Added missing hash property
  } as VAA<T>;
}

// Type for our mocked provider instance
type MockedEthersProvider = {
  getTransactionReceipt: jest.Mock<
    (txHash: string) => Promise<ethers.providers.TransactionReceipt | null>
  >;
  getNetwork: jest.Mock<() => Promise<ethers.providers.Network>>;
};

// --- Setup Function ---
export async function setupWormholeMocksAndService(
  scenario: TestScenario,
  testNetwork: Network,
): Promise<MockedWormholeInstances> {
  const SdkMockModule = jest.requireMock('@wormhole-foundation/sdk') as {
    wormhole: jest.MockedFunction<typeof wormhole>;
  };
  const MockedEthers = jest.requireMock('ethers') as {
    providers: {
      JsonRpcProvider: new (
        url?: string | ethers.utils.ConnectionInfo,
        network?: ethers.providers.Networkish,
      ) => ethers.providers.JsonRpcProvider;
    };
    // Add other ethers properties if needed by the setup function directly
  };

  mockWormholeEntry = SdkMockModule.wormhole;
  mockLogger = logger as jest.Mocked<typeof logger>;
  mockLogErrorContext = logErrorContext as jest.MockedFunction<typeof logErrorContext>;

  mockL2Provider = new MockedEthers.providers.JsonRpcProvider(
    scenario.l2RpcUrl,
  ) as unknown as MockedEthersProvider;
  mockL1Provider = new MockedEthers.providers.JsonRpcProvider(
    'http://mock-l1-rpc.com',
  ) as unknown as MockedEthersProvider;

  mockGetVaaSdkImplementation = mockWormholeInstance.getVaa as jest.Mock<
    <T extends PayloadLiteral>(
      id: WormholeMessageId,
      decodeAs: T,
      timeout?: number,
    ) => Promise<VAA<T> | null>
  >;

  // Type assertion for the mock implementation of getChain
  const l2ChainContextMock = {
    parseTransaction: jest.fn<() => Promise<WormholeMessageId[]>>(),
    // Add other specific ChainContext methods if needed by the service for L2
  } as unknown as jest.Mocked<InferredChainContext>;
  mockL2ChainContext = l2ChainContextMock;

  mockL1TokenBridgeOperations = {
    isTransferCompleted: jest.fn<(vaa: VAA<any>) => Promise<boolean>>(),
  };

  // Type assertion for the mock implementation of getChain for L1
  const l1ChainContextMock = {
    getTokenBridge: jest
      .fn<() => Promise<jest.MockedObject<TokenBridge<Network, Chain>>>>()
      .mockResolvedValue(
        mockL1TokenBridgeOperations as unknown as jest.MockedObject<TokenBridge<Network, Chain>>,
      ),
    // Add other specific ChainContext methods if needed by the service for L1
  } as unknown as jest.Mocked<InferredChainContext>;
  mockL1ChainContext = l1ChainContextMock;

  // Now type the getChain mock on mockWormholeInstance itself
  mockWormholeInstance.getChain.mockImplementation(
    (chainInput: Chain | ChainId): InferredChainContext => {
      const chainName =
        typeof chainInput === 'string' ? chainInput : actualChainIdToChain(chainInput as ChainId);
      if (chainName === scenario.l2ChainName) return mockL2ChainContext;
      if (chainName === scenario.targetL1ChainName) return mockL1ChainContext;
      throw new Error(
        `mockWormholeInstance.getChain: Unexpected chain: ${chainName}. Expected L2: ${scenario.l2ChainName} or L1: ${scenario.targetL1ChainName}`,
      );
    },
  );

  const wormholeVaaService = await WormholeVaaService.create(scenario.l2RpcUrl, testNetwork, []);

  return {
    wormholeVaaService,
    mockWormholeEntry,
    mockL2Provider,
    mockL1Provider,
    mockL2ChainContext,
    mockL1ChainContext,
    mockL1TokenBridgeOperations,
    mockLogger,
    mockLogErrorContext,
    mockGetVaaSdkImplementation,
    mockWormholeInstance: mockWormholeInstance,
  };
}

