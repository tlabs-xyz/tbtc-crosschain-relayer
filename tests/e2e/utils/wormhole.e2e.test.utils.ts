// process.env.USE_REAL_WORMHOLE_SERVICE = 'true'; // Signal global setup to NOT mock WormholeVaaService

import { jest } from '@jest/globals';

// Unmock WormholeVaaService for this utility file to ensure it uses the actual implementation
// The path is relative to THIS utility file (tests/e2e/utils/wormhole.e2e.test.utils.ts)
// and should point to services/WormholeVaaService.ts
jest.unmock('../../../services/WormholeVaaService');

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
} from '@wormhole-foundation/sdk';
import evmPlatform from '@wormhole-foundation/sdk/platforms/evm';
import suiPlatform from '@wormhole-foundation/sdk/platforms/sui';
// import solanaPlatform from '@wormhole-foundation/sdk/platforms/solana'; // If solana becomes relevant
import * as ethers from 'ethers'; // Changed from 'import { ethers } from ...'
import logger, { logErrorContext } from '../../../utils/Logger'; // Import directly
import { stringifyWithBigInt } from '../../../utils/Numbers';
import {
  type TestScenario,
  // L2_CHAIN_ID_SUI, // Not directly used in this file, but by tests
  // L2_CHAIN_ID_AVAX, // Not directly used in this file, but by tests
} from '../../data/wormhole.e2e.scenarios';
import { WormholeVaaService } from '../../../services/WormholeVaaService';

// --- Pre-define the core object that the mocked 'wormhole()' function will return ---
// This object's methods (getChain, getVaa) will be further fleshed out with specific jest.fn()
// implementations within setupWormholeMocksAndService.
const coreSdkMethodMocks = {
  getChain: jest.fn<(chain: Chain | ChainId) => MockedChainContext>(),
  getVaa:
    jest.fn<
      <T extends PayloadLiteral>(
        id: WormholeMessageId,
        decodeAs: T,
        timeout?: number,
      ) => Promise<VAA<T> | null>
    >(),
};

// Type for the InferredChainContext, derived from the getChain mock
// Assuming getChain returns an object with at least parseTransaction and getTokenBridge
type MockedChainContext = {
  parseTransaction: jest.Mock<(txid: string) => Promise<WormholeMessageId[]>>;
  getTokenBridge: jest.Mock<() => Promise<MockedTokenBridgeOperations>>;
  // Add other methods if used, e.g., getRelayer, getWrappedAsset...
};

type MockedTokenBridgeOperations = {
  isTransferCompleted: jest.Mock<(vaa: VAA<any>) => Promise<boolean>>;
  // Add other TokenBridge operations if needed, e.g. redeem, transfer...
};

// --- Global Constants for mocks ---
export const EXPECTED_GET_VAA_TIMEOUT_MS = 300000;
export const DEFAULT_PAYLOAD_LITERAL = 'TokenBridge:TransferWithPayload';
export const EXAMPLE_EMITTER_ADDRESS_SUI =
  '0x00000000000000000000000000000000000000000000000000000000deadbeef';
export const EXAMPLE_SEQUENCE = BigInt(123);

// --- Global Mock Variables (Typed) ---
// These are assigned within setupWormholeMocksAndService
export let mockWormholeEntry: jest.MockedFunction<typeof wormhole>;
export let mockL2Provider: jest.Mocked<ethers.providers.JsonRpcProvider>;
export let mockL1Provider: jest.Mocked<ethers.providers.JsonRpcProvider>;
export let mockL2ChainContext: MockedChainContext;
export let mockL1ChainContext: MockedChainContext;
export let mockL1TokenBridgeOperations: MockedTokenBridgeOperations;
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

// Define the specific generic function signature for getVaa mocks
type GenericGetVaaFn = <T extends PayloadLiteral>(
  id: WormholeMessageId,
  decodeAs: T,
  timeout?: number,
) => Promise<VAA<T> | null>;

// --- Mock Instance Types (for return type of setup function) ---
export interface MockedWormholeInstances {
  wormholeVaaService: WormholeVaaService;
  mockWormholeEntry: jest.MockedFunction<typeof wormhole>;
  mockL2Provider: jest.Mocked<ethers.providers.JsonRpcProvider>;
  mockL1Provider: jest.Mocked<ethers.providers.JsonRpcProvider>;
  mockL2ChainContext: MockedChainContext;
  mockL1ChainContext: MockedChainContext;
  mockL1TokenBridgeOperations: MockedTokenBridgeOperations;
  mockLogger: jest.Mocked<typeof logger>;
  mockLogErrorContext: jest.MockedFunction<typeof logErrorContext>;
  mockGetVaaSdkImplementation: jest.Mock<GenericGetVaaFn>;
  mockWormholeSdkInstance: typeof coreSdkMethodMocks; // Changed name for clarity
}

// --- SDK and Ethers Mocks ---

// Mock for @wormhole-foundation/sdk
jest.mock('@wormhole-foundation/sdk', () => {
  const originalSdk = jest.requireActual('@wormhole-foundation/sdk') as any;
  // console.log('[E2E Utils Mock Factory] mockWormholeInstance:', mockWormholeInstance); // REMOVED - caused error
  return {
    __esModule: true,
    ...originalSdk,
    Wormhole: originalSdk.Wormhole,
    UniversalAddress: originalSdk.UniversalAddress,
    chainIdToChain: originalSdk.chainIdToChain,
    wormhole: jest.fn(async () => coreSdkMethodMocks), // Use the pre-defined object
    Network: originalSdk.Network,
    Chain: originalSdk.Chain,
    toChainId: originalSdk.toChainId,
    TokenBridge: originalSdk.TokenBridge,
    ethers_contracts: originalSdk.ethers_contracts,
  };
});

// Mock for ethers
jest.mock('ethers', () => {
  const originalEthers = jest.requireActual('ethers') as typeof ethers; // Cast to typeof ethers for type safety

  // Define the type for our mock JsonRpcProvider instance methods
  type MockJsonRpcProviderInstanceMethods = {
    getTransactionReceipt: jest.Mock<
      (txHash: string) => Promise<ethers.providers.TransactionReceipt | null>
    >;
    getNetwork: jest.Mock<() => Promise<ethers.providers.Network>>;
    // Add other methods of JsonRpcProvider instance if called by the service
  };

  // This is the mock for the JsonRpcProvider class constructor
  const mockJsonRpcProviderConstructor = jest.fn(
    (_rpcUrl?: string): MockJsonRpcProviderInstanceMethods => {
      // Return a fresh set of mocks for each constructed instance
      return {
        getTransactionReceipt:
          jest.fn<(txHash: string) => Promise<ethers.providers.TransactionReceipt | null>>(), // Individual tests will mockResolvedValue on this
        getNetwork: jest.fn<() => Promise<ethers.providers.Network>>().mockResolvedValue({
          name: 'mock-network', // Static mock network name
          chainId: 123, // Static mock chain ID
        } as ethers.providers.Network), // Ensure it conforms to the type
      };
    },
  );

  return {
    // Return an object that matches the structure of the 'ethers' module
    providers: {
      JsonRpcProvider: mockJsonRpcProviderConstructor, // Our mocked constructor
    },
    utils: {
      ...originalEthers.utils,
    },
    BigNumber: originalEthers.BigNumber,
    Wallet: originalEthers.Wallet,
    Contract: originalEthers.Contract,
    // Add other ethers exports if they are used by the service or helper functions
  };
});

// Mock for Logger utility
jest.mock('../../../utils/Logger', () => ({
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
  // ethers is already mocked, so this will use the mocked BigNumber etc.
  return {
    to: '0xtoaddressmock',
    from: '0xfromaddressmock',
    contractAddress: '0xcontractaddressmock',
    transactionIndex: 1,
    gasUsed: ethers.BigNumber.from('21000'),
    logsBloom: '0xlogsBloommMock',
    blockHash: '0xblockhashmock',
    blockNumber: 1234567,
    confirmations: 10,
    cumulativeGasUsed: ethers.BigNumber.from('100000'),
    effectiveGasPrice: ethers.BigNumber.from('10000000000'), // Example: 10 Gwei
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
export function createMockSdkVaa<T extends PayloadLiteral = typeof DEFAULT_PAYLOAD_LITERAL>({
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

  // If a custom serialize function is provided, default .bytes to an empty array
  // to ensure the serialize function is called by the service.
  // Otherwise, use the provided bytes or the default [1,2,3,4,5].
  const vaaBytesContent = serialize
    ? (bytes ?? new Uint8Array(0))
    : (bytes ?? new Uint8Array([1, 2, 3, 4, 5]));

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
    bytes: vaaBytesContent, // Use the determined byte content
    serialize: serialize ?? jest.fn(() => new Uint8Array([1, 2, 3, 4, 5])),
    hash: mockHash, // Added missing hash property
  } as VAA<T>;
}

// Type for our mocked provider instance
// type MockedEthersProvider = {
//   getTransactionReceipt: jest.Mock<
//     (txHash: string) => Promise<ethers.providers.TransactionReceipt | null>
//   >;
//   getNetwork: jest.Mock<() => Promise<ethers.providers.Network>>;
// };

// --- Setup Function ---
export async function setupWormholeMocksAndService(
  scenario: TestScenario,
  testNetwork: Network,
): Promise<MockedWormholeInstances> {
  jest.clearAllMocks(); // Clear all mocks before setting up new ones

  // Use direct imports for already-mocked modules, and cast them.
  // Jest hoists jest.mock, so these are the mocked versions.
  mockWormholeEntry = wormhole as jest.MockedFunction<typeof wormhole>;
  mockLogger = logger as jest.Mocked<typeof logger>;
  mockLogErrorContext = logErrorContext as jest.MockedFunction<typeof logErrorContext>;
  const EthersProviders = ethers.providers;

  // L2 Provider setup
  mockL2Provider = new EthersProviders.JsonRpcProvider(
    scenario.l2RpcUrl,
  ) as jest.Mocked<ethers.providers.JsonRpcProvider>;

  // L1 Provider setup
  mockL1Provider = new EthersProviders.JsonRpcProvider(
    'http://mock-l1-rpc.com',
  ) as jest.Mocked<ethers.providers.JsonRpcProvider>;

  // Define mock implementations for SDK methods *before* WormholeVaaService.create is called
  const actualMockGetVaaImplementation: GenericGetVaaFn = <T extends PayloadLiteral>(
    id: WormholeMessageId,
    decodeAs: T,
    _timeout?: number,
  ): Promise<VAA<T> | null> => {
    // console.log(
    //   '[E2E Mock Util DEBUG getVaa] actualMockGetVaaImplementation CALLED with id:',
    //   stringifyWithBigInt(id),
    //   'decodeAs:',
    //   decodeAs,
    // );
    return Promise.resolve(null); // Fallback if not specifically mocked by test
  };

  mockGetVaaSdkImplementation = jest.fn(actualMockGetVaaImplementation);

  mockL1TokenBridgeOperations = {
    isTransferCompleted: jest.fn<(vaa: VAA<any>) => Promise<boolean>>().mockResolvedValue(false),
  };

  mockL2ChainContext = {
    parseTransaction: jest
      .fn<(txid: string) => Promise<WormholeMessageId[]>>()
      .mockImplementation(async (txid: string) => {
        return [];
      }),
    getTokenBridge: jest.fn<() => Promise<MockedTokenBridgeOperations>>().mockResolvedValue({
      isTransferCompleted: jest.fn<(vaa: VAA<any>) => Promise<boolean>>().mockResolvedValue(false),
    } as MockedTokenBridgeOperations),
  };

  mockL1ChainContext = {
    parseTransaction: jest
      .fn<(txid: string) => Promise<WormholeMessageId[]>>()
      .mockImplementation(async (txid: string) => {
        return [];
      }),
    getTokenBridge: jest
      .fn<() => Promise<MockedTokenBridgeOperations>>()
      .mockResolvedValue(mockL1TokenBridgeOperations),
  };

  // Configure coreSdkMethodMocks.getChain to return the correct chain context mock
  coreSdkMethodMocks.getChain.mockImplementation((chainOrChainId: Chain | ChainId) => {
    const chainName =
      typeof chainOrChainId === 'string' ? chainOrChainId : actualChainIdToChain(chainOrChainId);
    if (chainName === scenario.l2ChainName) {
      return mockL2ChainContext;
    }
    if (chainName === scenario.targetL1ChainName) {
      return mockL1ChainContext;
    }
    // Fallback for other chains if necessary
    const fallbackChainContext: MockedChainContext = {
      parseTransaction: jest
        .fn<(txid: string) => Promise<WormholeMessageId[]>>()
        .mockImplementation(async (txid: string) => {
          return [];
        }),
      getTokenBridge: jest.fn<() => Promise<MockedTokenBridgeOperations>>().mockResolvedValue({
        isTransferCompleted: jest
          .fn<(vaa: VAA<any>) => Promise<boolean>>()
          .mockResolvedValue(false),
      } as MockedTokenBridgeOperations),
    };
    return fallbackChainContext;
  });
  coreSdkMethodMocks.getVaa.mockImplementation(mockGetVaaSdkImplementation as GenericGetVaaFn);

  // Ensure the global SDK mock uses this setup
  // The `wormhole` function from `@wormhole-foundation/sdk` is already mocked at the top
  // to return `coreSdkMethodMocks`. So, accessing `wormhole` (which is the mock)
  // and setting its implementation is how we control the SDK's entry point.
  (wormhole as jest.Mock).mockImplementation(async () => coreSdkMethodMocks);

  // Create the service instance - this will use the mocked SDK via mockWormholeEntry
  const platformModulesToUse = [evmPlatform, suiPlatform];
  const wormholeVaaService = await WormholeVaaService.create(
    mockL2Provider,
    testNetwork,
    platformModulesToUse,
  );

  const instancesToReturn: MockedWormholeInstances = {
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
    mockWormholeSdkInstance: coreSdkMethodMocks,
  };
  // console.log(
  //   '[E2E Mock Util DEBUG] Returning from setupWormholeMocksAndService. mockL1TokenBridgeOperations defined:',
  //   !!instancesToReturn.mockL1TokenBridgeOperations,
  // );
  // if (instancesToReturn.mockL1TokenBridgeOperations) {
  //   console.log(
  //     '[E2E Mock Util DEBUG] mockL1TokenBridgeOperations.isTransferCompleted defined:',
  //     !!instancesToReturn.mockL1TokenBridgeOperations.isTransferCompleted,
  //   );
  // }

  return instancesToReturn;
}
