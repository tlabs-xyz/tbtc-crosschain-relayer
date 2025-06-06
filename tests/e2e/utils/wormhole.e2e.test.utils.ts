// tests/e2e/utils/wormhole.e2e.test.utils.ts - E2E test utilities for Wormhole integration
//
// This module provides mocks, helpers, and setup functions for Wormhole E2E tests in the tBTC cross-chain relayer.
// It covers SDK mocking, provider/chain context setup, and VAA/test data generation.

import { jest } from '@jest/globals';

jest.unmock('../../../services/WormholeVaaService');

import {
  type ChainId,
  type Network,
  type VAA,
  type WormholeMessageId,
  chainIdToChain as actualChainIdToChain,
  UniversalAddress as ActualUniversalAddressSdk,
  type Chain,
  type PayloadLiteral,
  wormhole,
} from '@wormhole-foundation/sdk';
import { toNative } from '@wormhole-foundation/sdk-connect';
import evmPlatform from '@wormhole-foundation/sdk/platforms/evm';
import suiPlatform from '@wormhole-foundation/sdk/platforms/sui';
import * as ethers from 'ethers';
import logger, { logErrorContext } from '../../../utils/Logger.js';
import { type TestScenario } from '../../data/wormhole.e2e.scenarios.js';
import { WormholeVaaService } from '../../../services/WormholeVaaService.js';
import {
  mockJsonRpcProviderInstance,
  type MockProvider as EthersMockProvider,
} from '../../mocks/ethers.helpers.js';

// =====================
// Core SDK Mocks & Constants
// =====================

// Core object that the mocked 'wormhole()' function will return
export const coreSdkMethodMocks = {
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
  deserialize: jest.fn(),
};

type MockedChainContext = {
  parseTransaction: jest.Mock<(txid: string) => Promise<WormholeMessageId[]>>;
  getTokenBridge: jest.Mock<() => Promise<MockedTokenBridgeOperations>>;
};

type MockedTokenBridgeOperations = {
  isTransferCompleted: jest.Mock<(vaa: VAA<PayloadLiteral>) => Promise<boolean>>;
};

// Constants
export const EXPECTED_GET_VAA_TIMEOUT_MS = 300000;
export const DEFAULT_PAYLOAD_LITERAL = 'TokenBridge:TransferWithPayload';
export const EXAMPLE_EMITTER_ADDRESS_SUI =
  '0x00000000000000000000000000000000000000000000000000000000deadbeef';
export const EXAMPLE_SEQUENCE = BigInt(123);

// =====================
// Global Mock Variables
// =====================

// Global mock variables - assigned within setupWormholeMocksAndService
export let mockWormholeEntry: jest.MockedFunction<typeof wormhole>;
export let mockL2Provider: EthersMockProvider;
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

type GenericGetVaaFn = <T extends PayloadLiteral>(
  id: WormholeMessageId,
  decodeAs: T,
  timeout?: number,
) => Promise<VAA<T> | null>;

export interface MockedWormholeInstances {
  wormholeVaaService: WormholeVaaService;
  mockWormholeEntry: jest.MockedFunction<typeof wormhole>;
  mockL2Provider: EthersMockProvider;
  mockL2ChainContext: MockedChainContext;
  mockL1ChainContext: MockedChainContext;
  mockL1TokenBridgeOperations: MockedTokenBridgeOperations;
  mockLogger: jest.Mocked<typeof logger>;
  mockLogErrorContext: jest.MockedFunction<typeof logErrorContext>;
  mockGetVaaSdkImplementation: jest.Mock<GenericGetVaaFn>;
  mockWormholeSdkInstance: typeof coreSdkMethodMocks;
}

// =====================
// SDK & Logger Mocks
// =====================

// SDK Mocks
jest.mock('@wormhole-foundation/sdk', () => {
  const originalSdk = jest.requireActual('@wormhole-foundation/sdk') as Record<string, unknown>;
  return {
    __esModule: true,
    Wormhole: originalSdk.Wormhole,
    UniversalAddress: originalSdk.UniversalAddress,
    chainIdToChain: originalSdk.chainIdToChain,
    wormhole: jest.fn(async () => coreSdkMethodMocks),
    Network: originalSdk.Network,
    Chain: originalSdk.Chain,
    toChainId: originalSdk.toChainId,
    TokenBridge: originalSdk.TokenBridge,
    ethers_contracts: originalSdk.ethers_contracts,
    deserialize: coreSdkMethodMocks.deserialize,
    ...Object.fromEntries(
      Object.entries(originalSdk).filter(([key]) => !['wormhole', 'deserialize'].includes(key)),
    ),
  };
});

jest.mock('../../../utils/Logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logErrorContext: jest.fn(),
}));

// =====================
// Helper Functions
// =====================

export function createMockEthersReceipt(
  txHash: string,
  status: number = 1,
): ethers.providers.TransactionReceipt {
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
    effectiveGasPrice: ethers.BigNumber.from('10000000000'),
    byzantium: true,
    type: 2,
    status: status,
    logs: [],
    root: '0xrootmock',
    transactionHash: txHash,
  };
}

interface CreateMockSdkVaaParams<T extends PayloadLiteral> {
  emitterChain?: ChainId;
  emitterAddress?: string;
  sequence?: bigint | number;
  consistencyLevel?: number;
  guardianSet?: number;
  payloadLiteral?: T;
  timestamp?: number;
  nonce?: number;
  bytes?: Uint8Array;
  serialize?: jest.Mock<() => Uint8Array>;
}

export function createMockSdkVaa<T extends PayloadLiteral = typeof DEFAULT_PAYLOAD_LITERAL>({
  emitterChain = 21 as ChainId,
  emitterAddress: nativeEmitterAddressString = EXAMPLE_EMITTER_ADDRESS_SUI,
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
  const chainName = actualChainIdToChain(emitterChain);

  const universalEmitterAddress = nativeEmitterAddressString
    ? toNative(chainName, nativeEmitterAddressString).toUniversalAddress()
    : new ActualUniversalAddressSdk(EXAMPLE_EMITTER_ADDRESS_SUI);

  const mockSerializeFn = serialize ?? jest.fn(() => new Uint8Array([1, 2, 3, 4, 5]));

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
    payload: { type: payloadLiteral, someData: 'mockPayloadData' } as unknown as T,
    serialize: mockSerializeFn,
    protocolName: 'TokenBridge',
    payloadLiteral: payloadLiteral,
    hash: new Uint8Array([1, 2, 3, 4, 5]),
  } as unknown as VAA<T>;

  if (bytes) {
    (vaaObject as VAA<T> & { bytes?: Uint8Array }).bytes = bytes;
  }

  return vaaObject;
}

export async function setupWormholeMocksAndService(
  scenario: TestScenario,
  testNetwork: Network,
): Promise<MockedWormholeInstances> {
  jest.clearAllMocks();

  // Re-assign logger mocks for each test
  mockLogger = logger as jest.Mocked<typeof logger>;
  mockLogErrorContext = logErrorContext as jest.MockedFunction<typeof logErrorContext>;
  mockWormholeEntry = wormhole as jest.MockedFunction<typeof wormhole>;

  // Assign the L2 provider mock instance from ethers.helpers
  // This is the instance that `new ethers.providers.JsonRpcProvider()` will return due to the mock in ethers.mock.ts
  mockL2Provider = mockJsonRpcProviderInstance;

  // Define ChainContext mocks for L2 and L1
  mockL2ChainContext = {
    parseTransaction: jest.fn<MockedChainContext['parseTransaction']>(),
    getTokenBridge: jest.fn<MockedChainContext['getTokenBridge']>(),
  };
  mockL1ChainContext = {
    parseTransaction: jest.fn<MockedChainContext['parseTransaction']>(),
    getTokenBridge: jest.fn<MockedChainContext['getTokenBridge']>(),
  };

  mockL1TokenBridgeOperations = {
    isTransferCompleted: jest.fn(async (_vaa: VAA<PayloadLiteral>) => false),
  };

  // Configure ChainContext mocks
  mockL2ChainContext.getTokenBridge.mockRejectedValue(
    new Error('getTokenBridge should not be called on L2 chain context in this E2E test setup'),
  );
  mockL1ChainContext.getTokenBridge.mockResolvedValue(mockL1TokenBridgeOperations);

  // Configure getChain mock
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
    throw new Error(`Unhandled chain in getChain mock: ${currentChainName}`);
  });

  // Setup wormhole SDK entry point mock
  (wormhole as jest.MockedFunction<typeof wormhole>).mockImplementation(
    // @ts-expect-error - Complex mock type compatibility issue with Wormhole SDK types
    async (_network: Network, _platforms?: unknown[]) => {
      if (!coreSdkMethodMocks) {
        logger.error(
          "FATAL: coreSdkMethodMocks is undefined when wormhole mock's implementation executes!",
        );
        throw new Error(
          "coreSdkMethodMocks is undefined when wormhole mock's implementation executes!",
        );
      }
      return coreSdkMethodMocks as typeof coreSdkMethodMocks;
    },
  );

  mockGetVaaSdkImplementation = coreSdkMethodMocks.getVaa as jest.Mock<GenericGetVaaFn>;

  // Instantiate the service
  if (!scenario.l2RpcUrl) {
    throw new Error(`scenario.l2RpcUrl is not defined for scenario: ${scenario.description}`);
  }

  // @ts-expect-error - Platform array type compatibility issue with test mocking
  const wormholeVaaService = await WormholeVaaService.create(scenario.l2RpcUrl, testNetwork, [
    () => Promise.resolve(evmPlatform),
    () => Promise.resolve(suiPlatform as unknown),
  ] as Array<() => Promise<unknown>>);

  // Validate L2 provider mock
  if (!mockL2Provider) {
    throw new Error('mockL2Provider is null or undefined after service creation.');
  }
  if (typeof mockL2Provider.getNetwork !== 'function') {
    throw new Error('mockL2Provider.getNetwork is not a function.');
  }
  if (!jest.isMockFunction(mockL2Provider.getNetwork)) {
    throw new Error('mockL2Provider.getNetwork is not a Jest mock function.');
  }
  if (!mockL2Provider.getNetwork.mockResolvedValue) {
    throw new Error('mockL2Provider.getNetwork does not have mockResolvedValue.');
  }

  // Set default getNetwork mock for L2 provider
  mockL2Provider.getNetwork.mockResolvedValue({
    name: `mock-l2-${actualChainIdToChain(scenario.l2ChainId)}-network`,
    chainId: scenario.l2ChainId,
  } as ethers.providers.Network);

  // Set default mock implementations
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
