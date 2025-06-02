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
  UniversalAddress as ActualUniversalAddressSdk, // Renamed to avoid conflict
  type Chain,
  type PayloadLiteral,
  wormhole,
} from '@wormhole-foundation/sdk';
import { toNative } from '@wormhole-foundation/sdk-connect'; // <<< ADDED IMPORT
import evmPlatform from '@wormhole-foundation/sdk/platforms/evm';
import suiPlatform from '@wormhole-foundation/sdk/platforms/sui';
// import solanaPlatform from '@wormhole-foundation/sdk/platforms/solana'; // If solana becomes relevant
import * as ethers from 'ethers'; // Changed from 'import { ethers } from ...'
import logger, { logErrorContext } from '../../../utils/Logger.js'; // Import directly
import {
  type TestScenario,
  // L2_CHAIN_ID_SUI, // Not directly used in this file, but by tests
  // L2_CHAIN_ID_AVAX, // Not directly used in this file, but by tests
} from '../../data/wormhole.e2e.scenarios.js';
import { WormholeVaaService } from '../../../services/WormholeVaaService.js';

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
  getVaaBytes: jest.fn<(id: WormholeMessageId, timeout?: number) => Promise<Uint8Array | null>>(),
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
  emitterAddress: nativeEmitterAddressString = EXAMPLE_EMITTER_ADDRESS_SUI, // Renamed for clarity
  sequence = EXAMPLE_SEQUENCE,
  consistencyLevel = 0,
  guardianSet = 0,
  payloadLiteral = DEFAULT_PAYLOAD_LITERAL as T,
  timestamp = Math.floor(Date.now() / 1000),
  nonce = 0,
  bytes, // This is the option from the caller
  serialize,
}: CreateMockSdkVaaParams<T> = {}): VAA<T> {
  const sequenceBigInt = BigInt(sequence);
  const chainName = actualChainIdToChain(emitterChain);

  // Convert native string address to UniversalAddress
  const universalEmitterAddress = nativeEmitterAddressString
    ? toNative(chainName, nativeEmitterAddressString).toUniversalAddress()
    : new ActualUniversalAddressSdk(EXAMPLE_EMITTER_ADDRESS_SUI); // Fallback just in case

  // Use provided serialize mock if available, otherwise mock a simple one
  const mockSerializeFn = serialize ?? jest.fn(() => new Uint8Array([1, 2, 3, 4, 5])); // Default serialize

  // prettier-ignore
  console.log(`[createMockSdkVaa DEBUG In Util] Options received: emitterChain=${emitterChain}, nativeEmitterAddressString=${nativeEmitterAddressString}, sequence=${sequence}, payloadLiteral=${payloadLiteral}, bytes Option provided (length): ${bytes?.length}, serialize Option provided: ${!!serialize}`);

  const vaaObject: VAA<T> = {
    version: 1,
    guardianSet,
    signatures: [],
    timestamp,
    nonce,
    emitterChain: chainName,
    emitterAddress: universalEmitterAddress,
    sequence: sequenceBigInt,
    consistencyLevel,
    payloadName: payloadLiteral,
    payload: { type: payloadLiteral, someData: 'mockPayloadData' } as any,
    serialize: mockSerializeFn,
    // Add required VAA fields for type compatibility
    protocolName: 'TokenBridge',
    payloadLiteral: payloadLiteral,
    hash: new Uint8Array([1, 2, 3, 4, 5]),
  } as VAA<T>; // Cast to VAA<T> to satisfy the type, we'll add bytes next if needed

  if (bytes) {
    // prettier-ignore
    console.log(`[createMockSdkVaa DEBUG In Util] Using provided 'bytes' option for vaaObject.bytes: ${bytes.join(',')}`);
    (vaaObject as any).bytes = bytes; // Assign if bytes are explicitly provided
  } else {
    // prettier-ignore
    console.log(`[createMockSdkVaa DEBUG In Util] 'bytes' option NOT provided, vaaObject.bytes will be undefined initially.`);
    // If bytes are not provided, vaaObject.bytes remains undefined, relying on serialize.
  }

  // prettier-ignore
  console.log(`[createMockSdkVaa DEBUG In Util] FINAL VAA Object Bytes: ${(vaaObject as any).bytes?.join(',')}`);

  return vaaObject;
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
  // Clear all mocks before each setup to ensure test isolation
  jest.clearAllMocks(); // Important to reset global jest state if any part of this setup relies on it

  // Re-assign logger mocks for each test
  mockLogger = logger as jest.Mocked<typeof logger>;
  mockLogErrorContext = logErrorContext as jest.MockedFunction<typeof logErrorContext>;

  // Assign the globally imported (and locally mocked) wormhole function to mockWormholeEntry for return
  mockWormholeEntry = wormhole as jest.MockedFunction<typeof wormhole>;

  // Define ChainContext mocks for L2 and L1 (Ensure these are defined before use below)
  mockL2ChainContext = {
    parseTransaction: jest.fn<MockedChainContext['parseTransaction']>(),
    getTokenBridge: jest.fn<MockedChainContext['getTokenBridge']>(),
  };
  mockL1ChainContext = {
    parseTransaction: jest.fn<MockedChainContext['parseTransaction']>(),
    getTokenBridge: jest.fn<MockedChainContext['getTokenBridge']>(),
  };

  // Define L1 TokenBridgeOperations mock
  mockL1TokenBridgeOperations = {
    isTransferCompleted: jest.fn(async (vaa: VAA<any>) => {
      // prettier-ignore
      console.log(`[DEBUG E2E Utils - mockL1TokenBridgeOperations.isTransferCompleted CORE MOCK] CALLED. VAA Seq: ${vaa?.sequence}, Emitter: ${vaa?.emitterAddress?.toString()}, Chain: ${vaa?.emitterChain}, PayloadName: ${vaa?.payloadName}`);
      return false; // Default return, tests will override
    }),
  };

  // Configure L2ChainContext: getTokenBridge on L2 should typically not be called or should throw
  mockL2ChainContext.getTokenBridge.mockRejectedValue(
    new Error('getTokenBridge should not be called on L2 chain context in this E2E test setup'),
  );
  // Configure L1ChainContext to return the L1 TokenBridge operations
  mockL1ChainContext.getTokenBridge.mockResolvedValue(mockL1TokenBridgeOperations);

  // Configure the getChain mock for L2 and L1 directly on coreSdkMethodMocks
  // This is moved from inside the wormhole.mockImplementation body.
  if (!coreSdkMethodMocks) {
    throw new Error(
      'FATAL: coreSdkMethodMocks is undefined before configuring its methods in setupWormholeMocksAndService.',
    );
  }
  coreSdkMethodMocks.getChain.mockImplementation((chainOrChainId: Chain | ChainId) => {
    const currentChainName =
      typeof chainOrChainId === 'string' ? chainOrChainId : actualChainIdToChain(chainOrChainId);
    if (currentChainName === actualChainIdToChain(scenario.l2ChainId)) {
      return mockL2ChainContext;
    }
    if (currentChainName === actualChainIdToChain(scenario.targetL1ChainId)) {
      return mockL1ChainContext;
    }
    console.error(
      `[E2E Utils DEBUG] coreSdkMethodMocks.getChain called with unexpected chain: ${currentChainName}. Scenario L2: ${actualChainIdToChain(scenario.l2ChainId)}, Scenario L1 Target: ${actualChainIdToChain(scenario.targetL1ChainId)}`,
    );
    throw new Error(`Unhandled chain in getChain mock: ${currentChainName}`);
  });

  // Setup the main `wormhole()` SDK entry point mock
  // The imported `wormhole` (from E2E test file's mock context) will now just return the pre-configured coreSdkMethodMocks.
  (wormhole as jest.MockedFunction<typeof wormhole>).mockImplementation(
    async (_network: Network, _platforms?: any[]) => {
      if (!coreSdkMethodMocks) {
        console.error(
          "FATAL: coreSdkMethodMocks is undefined when wormhole mock's implementation executes!",
        );
        throw new Error(
          "coreSdkMethodMocks is undefined when wormhole mock's implementation executes!",
        );
      }
      return coreSdkMethodMocks as any; // Cast to any because the mocked type is simplified
    },
  );

  // Assign the specific mock for getVaa to the exported variable
  // This makes mockGetVaaSdkImplementation a reference to coreSdkMethodMocks.getVaa
  mockGetVaaSdkImplementation = coreSdkMethodMocks.getVaa as jest.Mock<GenericGetVaaFn>;

  // Instantiate the actual service (it will pick up the mocked SDK via jest.mock)
  // Correctly use WormholeVaaService.create()
  // Assuming scenario.l2RpcUrl exists and platform modules are evmPlatform, suiPlatform as imported.
  if (!scenario.l2RpcUrl) {
    throw new Error(`scenario.l2RpcUrl is not defined for scenario: ${scenario.description}`);
  }
  const wormholeVaaService = await WormholeVaaService.create(scenario.l2RpcUrl, testNetwork, [
    evmPlatform,
    suiPlatform,
  ]);

  // 3. Capture the mocked L2 provider instance.
  mockL2Provider = (wormholeVaaService as any)
    .l2Provider as jest.Mocked<ethers.providers.JsonRpcProvider>;

  // Ensure the L2 provider was actually created and is a mock instance
  if (!mockL2Provider) {
    throw new Error('mockL2Provider is null or undefined after service creation.');
  }
  if (typeof mockL2Provider.getNetwork !== 'function') {
    throw new Error('mockL2Provider.getNetwork is not a function.');
  }
  // Check if it's a Jest mock function (has _isMockFunction property)
  if (!(mockL2Provider.getNetwork as any)._isMockFunction) {
    throw new Error('mockL2Provider.getNetwork is not a Jest mock function.');
  }
  // The original check (if the above passes, this should too, unless mockResolvedValue is not on jest.fn type)
  if (!mockL2Provider.getNetwork.mockResolvedValue) {
    throw new Error('mockL2Provider.getNetwork does not have mockResolvedValue (original check).');
  }

  // Set default getNetwork mock for L2 provider
  mockL2Provider.getNetwork.mockResolvedValue({
    name: `mock-l2-${actualChainIdToChain(scenario.l2ChainId)}-network`,
    chainId: scenario.l2ChainId,
  } as ethers.providers.Network);

  // Note: L1 provider is not directly managed or exposed by WormholeVaaService.
  // The Wormhole SDK (this.wh) handles L1 interactions. If the SDK creates an
  // ethers.JsonRpcProvider for L1, it will also use our mocked constructor.
  // Individual tests might need to ensure that the SDK's L1 provider calls getNetwork
  // with an expected chainId, or we might need a more advanced way to capture
  // all JsonRpcProvider instances created if L1 network checks become an issue.

  // Default mock implementations (can be overridden by specific tests)
  mockL2ChainContext.parseTransaction.mockResolvedValue([]);
  mockL1TokenBridgeOperations.isTransferCompleted.mockResolvedValue(false);
  mockGetVaaSdkImplementation.mockResolvedValue(null);

  return {
    wormholeVaaService,
    mockWormholeEntry,
    mockL2Provider,
    mockL2ChainContext,
    mockL1ChainContext,
    mockL1TokenBridgeOperations,
    mockLogger,
    mockLogErrorContext,
    mockGetVaaSdkImplementation,
    mockWormholeSdkInstance: coreSdkMethodMocks,
  };
}
