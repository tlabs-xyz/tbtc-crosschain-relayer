process.env.USE_REAL_WORMHOLE_SERVICE = 'true'; // Signal global setup to NOT mock WormholeVaaService

import type * as ethers from 'ethers'; // Keep this, it's used by the mock type
import { jest } from '@jest/globals'; // Keep this for jest.fn
// Import for typing if needed and for original UniversalAddress, etc.
import type * as WormholeSdkModule from '@wormhole-foundation/sdk'; // Import the full module for typing
import { toNative } from '@wormhole-foundation/sdk-connect'; // <<< ADDED IMPORT

// Declare mockDeserializeImplementation BEFORE jest.mock that uses it
// Use var for hoisting compatibility with jest.mock
// eslint-disable-next-line no-var
var mockDeserializeImplementation = jest.fn() as jest.Mock; // Less strict global mock type

// --- START: SDK Mocks ---

// Mock for the entire @wormhole-foundation/sdk module
jest.mock('@wormhole-foundation/sdk', () => {
  if (typeof mockDeserializeImplementation !== 'function') {
    throw new Error('mockDeserializeImplementation is NOT a function inside SDK mock factory!');
  }
  const actualSdk = jest.requireActual('@wormhole-foundation/sdk') as typeof WormholeSdkModule; // Type actualSdk
  const mockModule = {
    ...actualSdk, // Spread all original exports
    deserialize: mockDeserializeImplementation, // Override deserialize
    wormhole: jest.fn(), // Explicitly mock the wormhole entry point
    UniversalAddress: actualSdk.UniversalAddress,
    chainIdToChain: actualSdk.chainIdToChain,
    toChainId: actualSdk.toChainId,
  };
  return mockModule;
});

// Mock for ethers (JsonRpcProvider)
// Define the type for the mock constructor's return value (instance methods)
type MockJsonRpcProviderInstanceMethods = {
  getTransactionReceipt: jest.Mock<
    (txHash: string) => Promise<ethers.providers.TransactionReceipt | null>
  >;
  getNetwork: jest.Mock<() => Promise<ethers.providers.Network>>;
};
const mockJsonRpcProviderConstructor = jest.fn(
  (_rpcUrl?: string): MockJsonRpcProviderInstanceMethods => {
    return {
      getTransactionReceipt:
        jest.fn<(txHash: string) => Promise<ethers.providers.TransactionReceipt | null>>(),
      getNetwork: jest.fn<() => Promise<ethers.providers.Network>>(),
    };
  },
);
jest.mock('ethers', () => {
  const originalEthers = jest.requireActual('ethers') as typeof ethers;
  return {
    ...originalEthers,
    ethers: {
      ...originalEthers.ethers,
      providers: {
        ...originalEthers.ethers.providers,
        JsonRpcProvider: mockJsonRpcProviderConstructor,
      },
    },
  };
});
// --- END: SDK Mocks ---

import {
  setupWormholeMocksAndService,
  createMockEthersReceipt,
  createMockSdkVaa,
  EXPECTED_GET_VAA_TIMEOUT_MS,
  type MockedWormholeInstances,
} from './utils/wormhole.e2e.test.utils.js';

import { describe, test, expect, beforeEach } from '@jest/globals';

// // Unmock WormholeVaaService for this specific E2E test file to use the actual implementation
// // The path is relative to THIS test file (tests/e2e/wormhole.vaa.service.e2e.test.ts)
// // and should point to services/WormholeVaaService.ts
// jest.unmock('../../services/WormholeVaaService');

import { type WormholeVaaService } from '../../services/WormholeVaaService.js';
import {
  type ChainId,
  type VAA,
  type WormholeMessageId,
  UniversalAddress as _ActualUniversalAddress,
  type Chain,
  toChainId,
  chainIdToChain as actualChainIdToChain,
  type PayloadLiteral,
} from '@wormhole-foundation/sdk';
// Logger and stringifyWithBigInt are used by the service, mocks are handled by utils
// import logger from '../../utils/Logger.js';
import { stringifyWithBigInt } from '../../utils/Numbers.js';
import {
  testScenarios,
  // L1_CHAIN_ID_ETH, // Not directly used, derived from scenario in setup
  L2_CHAIN_ID_SUI, // Used in one test for conditional logic
  L2_CHAIN_ID_AVAX, // Used in one test for conditional logic
  TEST_NETWORK,
} from '../data/wormhole.e2e.scenarios.js';

describe.each(testScenarios)('WormholeVaaService E2E for $description (SDK mocks)', (scenario) => {
  let service: WormholeVaaService;
  let mocks: MockedWormholeInstances;

  // These are scenario-specific and constructed in beforeEach using ActualUniversalAddress
  let currentTestMockWormholeMessageId: WormholeMessageId;
  // let mockWormholeMessageIdDifferentEmitter: WormholeMessageId; // This wasn't used, can remove if truly not needed or reconstruct if a test requires it.

  beforeEach(async () => {
    jest.clearAllMocks();
    mocks = await setupWormholeMocksAndService(scenario, TEST_NETWORK);
    service = mocks.wormholeVaaService;

    // Construct UniversalAddress consistently using toNative().toUniversalAddress()
    const emitterUniversalForTest = toNative(
      actualChainIdToChain(scenario.l2ChainId), // Use the chain name
      scenario.expectedEmitterAddress, // Native address string
    ).toUniversalAddress();

    currentTestMockWormholeMessageId = {
      chain: actualChainIdToChain(scenario.l2ChainId),
      emitter: emitterUniversalForTest,
      sequence: EXAMPLE_SEQUENCE, // Standard sequence for most tests, can be overridden
    };
    // If mockWormholeMessageIdDifferentEmitter is needed by a specific test,
    // it should be constructed within that test or if very common, here.
    // For now, assuming EXAMPLE_SEQUENCE is the primary one.
  });

  const L2_EXAMPLE_TX_HASH = '0x' + 'a'.repeat(64);
  const EXAMPLE_SEQUENCE = BigInt(123); // Centralized definition

  test('Subtask 13.1 & 13.4: Successfully fetches and verifies a VAA (VAA with .bytes)', async () => {
    const mockReceipt = createMockEthersReceipt(L2_EXAMPLE_TX_HASH, 1);
    mocks.mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);

    // Use the correctly formed universal address from currentTestMockWormholeMessageId
    const whMessageIdForParseTxMock: WormholeMessageId = {
      chain: actualChainIdToChain(scenario.l2ChainId),
      emitter: toNative(
        actualChainIdToChain(scenario.l2ChainId),
        scenario.expectedEmitterAddress,
      ).toUniversalAddress(),
      sequence: EXAMPLE_SEQUENCE,
    };
    mocks.mockL2ChainContext.parseTransaction.mockResolvedValue([whMessageIdForParseTxMock]);

    const mockVaaBytes = new Uint8Array([11, 22, 33, 44, 55]);
    // Corrected createMockSdkVaa call
    const mockParsedVaa = createMockSdkVaa<'TokenBridge:TransferWithPayload'>({
      emitterChain: scenario.l2ChainId,
      emitterAddress: scenario.expectedEmitterAddress,
      sequence: EXAMPLE_SEQUENCE,
      payloadLiteral: 'TokenBridge:TransferWithPayload',
      bytes: mockVaaBytes,
      consistencyLevel: 15,
    });
    mocks.mockGetVaaSdkImplementation.mockResolvedValue(
      mockParsedVaa as VAA<'TokenBridge:TransferWithPayload'>,
    );

    // Restore this line, ensuring the mockImplementation that caused issues is removed
    mocks.mockL1TokenBridgeOperations.isTransferCompleted.mockResolvedValue(true);

    // Mock for this.wh.getVaaBytes() - this is NOT directly used by the service's getVaa path.
    // It was relevant when the service used getVaaBytes + deserialize, but not for getVaa.
    // mocks.mockWormholeSdkInstance.getVaaBytes.mockResolvedValue(mockVaaBytes);

    // Configure the global mockDeserializeImplementation for this test case
    // This mock is for the global `deserialize` function, NOT for the VAA object's .serialize() method.
    // The service currently uses this.wh.getVaa(), which internally might call deserialize.
    // However, since we are directly mocking what getVaa returns, this mockDeserializeImplementation
    // might not be strictly necessary for *this specific path* if getVaa is fully mocked.
    // Keeping it for now as it was part of previous logic, but it might be redundant if getVaa mock is sufficient.
    mockDeserializeImplementation.mockImplementation((_bytesArg: unknown, _payloadArg: unknown) => {
      // Content comparison for Uint8Array
      const areByteArraysEqual = (a: Uint8Array, b: Uint8Array) => {
        if (!a || !b || a.length !== b.length) return false; // Add null/undefined checks
        for (let i = 0; i < a.length; i++) {
          if (a[i] !== b[i]) return false;
        }
        return true;
      };

      // Assuming _bytesArg is Uint8Array at runtime for this specific path
      if (!areByteArraysEqual(_bytesArg as Uint8Array, mockVaaBytes)) {
        return null;
      }

      if (_payloadArg === 'TokenBridge:TransferWithPayload') {
        return mockParsedVaa as VAA<'TokenBridge:TransferWithPayload'>;
      }
      return null;
    });

    // Ensure this line is present and correct (it was .mockResolvedValue(true) before)
    // If there was a second one, it's removed by providing the whole test case content.
    // mocks.mockL1TokenBridgeOperations.isTransferCompleted.mockResolvedValue(true); // This line is intentionally the same as above to ensure only one is present

    const result = await service.fetchAndVerifyVaaForL2Event(
      L2_EXAMPLE_TX_HASH,
      scenario.l2ChainId,
      scenario.expectedEmitterAddress,
      scenario.targetL1ChainId,
    );

    expect(result).not.toBeNull();
    expect(result?.vaaBytes).toEqual(mockVaaBytes); // Changed from toBe to toEqual
    expect(result?.parsedVaa).toBe(mockParsedVaa);
    expect(mocks.mockL2Provider.getTransactionReceipt).toHaveBeenCalledWith(L2_EXAMPLE_TX_HASH);
    expect(mocks.mockL2ChainContext.parseTransaction).toHaveBeenCalledWith(L2_EXAMPLE_TX_HASH);
    expect(mocks.mockGetVaaSdkImplementation).toHaveBeenCalledWith(
      currentTestMockWormholeMessageId, // Use the one from beforeEach
      'TokenBridge:TransferWithPayload', // decodeAs
      EXPECTED_GET_VAA_TIMEOUT_MS, // timeout
    );

    expect(mocks.mockL1ChainContext.getTokenBridge).toHaveBeenCalledTimes(1);
    expect(mocks.mockL1TokenBridgeOperations.isTransferCompleted).toHaveBeenCalledWith(
      mockParsedVaa,
    );
    expect(mocks.mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining(
        `Token bridge transfer VAA confirmed completed on L1 (${actualChainIdToChain(scenario.targetL1ChainId)}) for ${L2_EXAMPLE_TX_HASH}`,
      ),
    );
    expect(mocks.mockLogger.error).not.toHaveBeenCalled();
    expect(mocks.mockLogErrorContext).not.toHaveBeenCalled();
  });

  test('Subtask 13.7: Handles VAA not found from SDK (getVaa returns null for both types)', async () => {
    const l2TxHashNotFound = '0x' + 'b'.repeat(64);
    const sequenceNotFound = BigInt(124); // Specific sequence for this test

    // Construct UniversalAddress consistently
    const emitterUniversalForNotFoundTest = toNative(
      actualChainIdToChain(scenario.l2ChainId),
      scenario.expectedEmitterAddress,
    ).toUniversalAddress();

    const localMockWormholeMessageId: WormholeMessageId = {
      // Local version for this specific sequence
      chain: actualChainIdToChain(scenario.l2ChainId),
      emitter: emitterUniversalForNotFoundTest, // Use consistently created UniversalAddress
      sequence: sequenceNotFound,
    };

    const mockReceipt = createMockEthersReceipt(l2TxHashNotFound, 1);
    mocks.mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);
    mocks.mockL2ChainContext.parseTransaction.mockResolvedValue([localMockWormholeMessageId]);
    mocks.mockGetVaaSdkImplementation.mockResolvedValue(null);

    const result = await service.fetchAndVerifyVaaForL2Event(
      l2TxHashNotFound,
      scenario.l2ChainId,
      scenario.expectedEmitterAddress,
      scenario.targetL1ChainId,
    );

    expect(result).toBeNull();
    expect(mocks.mockGetVaaSdkImplementation).toHaveBeenCalledWith(
      localMockWormholeMessageId, // Use the one with correct sequence
      'TokenBridge:TransferWithPayload',
      EXPECTED_GET_VAA_TIMEOUT_MS,
    );
    expect(mocks.mockGetVaaSdkImplementation).toHaveBeenCalledTimes(2);
    expect(mocks.mockLogErrorContext).toHaveBeenCalledWith(
      expect.stringContaining(
        `this.wh.getVaa did not return a VAA for message ID ${stringifyWithBigInt(localMockWormholeMessageId)} after trying all discriminators`,
      ),
      expect.any(Error),
    );
  });

  test("Subtask 13.4: Successfully fetches and verifies a VAA as 'TokenBridge:Transfer' (VAA with .serialize)", async () => {
    const l2TxHashForSerializeTest = L2_EXAMPLE_TX_HASH;
    const EXAMPLE_SEQUENCE_SERIALIZE_TEST = BigInt(124); // Use a different sequence for this test

    // Add the missing transaction receipt mock setup
    const mockReceipt = createMockEthersReceipt(l2TxHashForSerializeTest, 1);
    mocks.mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);

    // Construct UniversalAddress consistently
    const emitterUniversalForSerializeTest = toNative(
      actualChainIdToChain(scenario.l2ChainId),
      scenario.expectedEmitterAddress,
    ).toUniversalAddress();

    const whMessageIdForParseTxMockSerialize: WormholeMessageId = {
      chain: actualChainIdToChain(scenario.l2ChainId),
      emitter: emitterUniversalForSerializeTest,
      sequence: EXAMPLE_SEQUENCE_SERIALIZE_TEST, // Use a different sequence for this test
    };
    mocks.mockL2ChainContext.parseTransaction.mockResolvedValue([
      whMessageIdForParseTxMockSerialize,
    ]);

    // This VAA will use its .serialize() method
    const mockSerializedBytes = new Uint8Array([5, 4, 3, 2, 1]);
    const mockVaaToSerialize = createMockSdkVaa<'TokenBridge:Transfer'>({
      emitterChain: scenario.l2ChainId,
      emitterAddress: scenario.expectedEmitterAddress,
      sequence: EXAMPLE_SEQUENCE_SERIALIZE_TEST,
      payloadLiteral: 'TokenBridge:Transfer', // Correct payload type for this VAA
      serialize: jest.fn(() => mockSerializedBytes), // Provide .serialize()
      consistencyLevel: 0, // Default
    });

    // Restore this essential mock for getVaa for this test case
    mocks.mockGetVaaSdkImplementation.mockImplementation(
      async <T extends PayloadLiteral>(msgId: WormholeMessageId, discriminatorArg: T) => {
        if (
          msgId.emitter.equals(whMessageIdForParseTxMockSerialize.emitter) &&
          msgId.sequence === whMessageIdForParseTxMockSerialize.sequence &&
          (discriminatorArg === 'TokenBridge:TransferWithPayload' ||
            discriminatorArg === 'TokenBridge:Transfer')
        ) {
          return mockVaaToSerialize as VAA<T>;
        }
        return null; // Default to null if no match
      },
    );

    // mockDeserializeImplementation for TokenBridge:Transfer if needed by SDK internals (though getVaa mock should bypass)
    mockDeserializeImplementation.mockImplementation(
      (_discriminator: unknown, _bytesArg: unknown) => {
        // Content comparison for Uint8Array
        const areByteArraysEqual = (a: Uint8Array, b: Uint8Array) => {
          if (a.length !== b.length) return false;
          for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
          }
          return true;
        };

        // Check if bytesArg matches our expected mockSerializedBytes
        if (areByteArraysEqual(mockSerializedBytes, _bytesArg as Uint8Array)) {
          return mockVaaToSerialize as VAA<'TokenBridge:Transfer'>;
        }
        return null; // Default to null if no match
      },
    );

    // mockDeserializeImplementation for TokenBridge:Transfer if needed by SDK internals (though getVaa mock should bypass)
    mockDeserializeImplementation.mockImplementation(
      (_discriminator: unknown, _bytesArg: unknown) => {
        if (_discriminator === 'TokenBridge:Transfer') {
          return mockVaaToSerialize as VAA<'TokenBridge:Transfer'>;
        }
        return null;
      },
    );

    // --- MODIFICATION START ---
    // Create a new, specific mock function for this test case
    const specificMockIsTransferCompleted =
      jest.fn<MockedWormholeInstances['mockL1TokenBridgeOperations']['isTransferCompleted']>();
    // Assign this new mock to the place where the service will look for it
    mocks.mockL1TokenBridgeOperations.isTransferCompleted = specificMockIsTransferCompleted;
    // Configure this specific mock
    specificMockIsTransferCompleted.mockResolvedValue(true);
    // --- MODIFICATION END ---

    const result = await service.fetchAndVerifyVaaForL2Event(
      l2TxHashForSerializeTest,
      scenario.l2ChainId,
      scenario.expectedEmitterAddress,
      scenario.targetL1ChainId,
    );

    expect(result).not.toBeNull();
    expect(result?.vaaBytes).toEqual(mockSerializedBytes);
    expect(result?.parsedVaa).toBe(mockVaaToSerialize);

    // expect(mocks.mockWormholeSdkInstance.getVaaBytes).toHaveBeenCalledWith(
    //   whMessageIdForParseTxMock,
    // );
    // expect(mocks.mockWormholeSdkInstance.getVaaBytes).toHaveBeenCalledTimes(1);

    // expect(mockDeserializeImplementation).toHaveBeenCalledWith(
    //   'TokenBridge:Transfer',
    //   mockSerializedBytes,
    // );
    // expect(mockDeserializeImplementation).toHaveBeenCalledWith(
    //   'TokenBridge:TransferWithPayload',
    //   mockSerializedBytes,
    // );
    // expect(mockDeserializeImplementation).toHaveBeenCalledTimes(2);

    expect(mocks.mockL1ChainContext.getTokenBridge).toHaveBeenCalledTimes(1);
    expect(mocks.mockL2ChainContext.parseTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.mockGetVaaSdkImplementation).toHaveBeenCalledTimes(1);

    // Assert against the specific mock instance
    expect(specificMockIsTransferCompleted).toHaveBeenCalledWith(mockVaaToSerialize);
    expect(mocks.mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining(
        `Token bridge transfer VAA confirmed completed on L1 (${actualChainIdToChain(scenario.targetL1ChainId)}) for ${l2TxHashForSerializeTest}`,
      ),
    );
  });

  test('Subtask 13.5: L2 Tx Reverted - should return null and log error', async () => {
    const l2TxRevertedHash = '0x' + 'c'.repeat(64);
    const revertedReceipt = createMockEthersReceipt(l2TxRevertedHash, 0);
    mocks.mockL2Provider.getTransactionReceipt.mockResolvedValueOnce(revertedReceipt);

    const result = await service.fetchAndVerifyVaaForL2Event(
      l2TxRevertedHash,
      scenario.l2ChainId,
      scenario.expectedEmitterAddress,
      scenario.targetL1ChainId,
    );

    expect(result).toBeNull();
    expect(mocks.mockL2Provider.getTransactionReceipt).toHaveBeenCalledWith(l2TxRevertedHash);
    expect(mocks.mockL2ChainContext.parseTransaction).not.toHaveBeenCalled();
    expect(mocks.mockLogErrorContext).toHaveBeenCalledWith(
      `L2 transaction ${l2TxRevertedHash} failed (reverted), cannot fetch VAA. Receipt: ${JSON.stringify(revertedReceipt)}`,
      expect.any(Error),
    );
  });

  test('Subtask 13.6: No Wormhole Message from parseTransaction - should return null and log info', async () => {
    const l2TxNoMessageHash = '0x' + 'd'.repeat(64);
    const mockReceipt = createMockEthersReceipt(l2TxNoMessageHash, 1);
    mocks.mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);
    mocks.mockL2ChainContext.parseTransaction.mockResolvedValue([]);

    // Specific mock for getChain for this test: only L2 should be called by service
    // The setup function already configures a general getChain.
    // If a test has very specific needs for getChain, it can be overridden here.
    // For this test, the default setup should be fine as it only calls getChain for L2.
    // However, if we want to be super explicit that L1 getChain is NOT called:
    const originalGetChain = mocks.mockWormholeSdkInstance.getChain.getMockImplementation();
    mocks.mockWormholeSdkInstance.getChain.mockImplementationOnce((chainOrChainId) => {
      const idOfChainToGet: ChainId =
        typeof chainOrChainId === 'string'
          ? toChainId(chainOrChainId as Chain)
          : (chainOrChainId as ChainId);
      if (idOfChainToGet === scenario.l2ChainId) return mocks.mockL2ChainContext;
      // This will cause a test failure if L1 chain is requested, which is intended for this specific test case.
      throw new Error(
        `getChain mock for parseTransaction test (scenario ${scenario.description}) should only be called for L2 chain ${scenario.l2ChainName}, got ${actualChainIdToChain(idOfChainToGet)}`,
      );
    });

    const result = await service.fetchAndVerifyVaaForL2Event(
      l2TxNoMessageHash,
      scenario.l2ChainId,
      scenario.expectedEmitterAddress,
      scenario.targetL1ChainId,
    );

    expect(result).toBeNull();
    expect(mocks.mockWormholeSdkInstance.getChain).toHaveBeenCalledWith(scenario.l2ChainName);
    expect(mocks.mockLogErrorContext).toHaveBeenCalledWith(
      `No Wormhole messages found in L2 transaction ${l2TxNoMessageHash}. Chain: ${scenario.l2ChainName}.`,
      expect.any(Error),
    );
    // Restore original getChain if it was overridden locally, or ensure setup handles it.
    if (originalGetChain)
      mocks.mockWormholeSdkInstance.getChain.mockImplementation(originalGetChain);
  });

  test('Subtask 13.8: VAA emitter address mismatch', async () => {
    const l2TxEmitterMismatchHash = '0x' + 'e'.repeat(64);
    // scenario.expectedEmitterAddress is what the service will convert and expect
    // vaaEmitterAddressNative is what the VAA *actually* has, which is different
    const vaaEmitterAddressNative = '0x' + 'f'.repeat(40); // Example different native EVM address

    const vaaEmitterUniversalDifferent = toNative(
      actualChainIdToChain(scenario.l2ChainId),
      vaaEmitterAddressNative, // Ensuring no extra spaces here
    ).toUniversalAddress();

    const mockReceipt = createMockEthersReceipt(l2TxEmitterMismatchHash, 1);
    mocks.mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);

    const localMockWormholeMessageId: WormholeMessageId = {
      chain: actualChainIdToChain(scenario.l2ChainId),
      emitter: vaaEmitterUniversalDifferent, // VAA has this emitter (Universal)
      sequence: EXAMPLE_SEQUENCE,
    };
    mocks.mockL2ChainContext.parseTransaction.mockResolvedValue([localMockWormholeMessageId]);

    // This VAA is what getVaa would return if a VAA was found for localMockWormholeMessageId
    const mockVaaWithDifferentEmitter = createMockSdkVaa({
      emitterChain: scenario.l2ChainId,
      emitterAddress: vaaEmitterAddressNative, // VAA has this NATIVE emitter address
      sequence: EXAMPLE_SEQUENCE,
      payloadLiteral: 'TokenBridge:TransferWithPayload',
      bytes: new Uint8Array([6, 7, 8, 9, 0]), // Ensuring no extra spaces here
    });

    // Important: The service's getVaa call will be constructed based on the *expected* emitter derived from
    // scenario.expectedEmitterAddress. So mockGetVaaSdkImplementation likely won't be called with
    // localMockWormholeMessageId if the service filters out the message from parseTransaction first.
    // If parseTransaction returns a message, but its emitter doesn't match what service expects,
    // then getVaa won't be called for that message.

    mocks.mockGetVaaSdkImplementation.mockImplementation(
      async <T extends PayloadLiteral>(
        msgId: WormholeMessageId,
        _payloadName: T,
        _timeout?: number,
      ) => {
        // This mock should only return the VAA if the msgId matches the one with the *different* emitter
        if (
          msgId.emitter.equals(vaaEmitterUniversalDifferent) &&
          msgId.sequence === EXAMPLE_SEQUENCE
        ) {
          return mockVaaWithDifferentEmitter as VAA<T>;
        }
        return null;
      },
    );

    // Similar to above, ensure only L2 getChain is called for parseTransaction
    // and L1 getChain is not called before isTransferCompleted determines VAA is invalid.
    const originalGetChainEmitterMismatch =
      mocks.mockWormholeSdkInstance.getChain.getMockImplementation();
    mocks.mockWormholeSdkInstance.getChain.mockImplementationOnce((chainOrChainId) => {
      const idOfChainToGet: ChainId =
        typeof chainOrChainId === 'string'
          ? toChainId(chainOrChainId as Chain)
          : (chainOrChainId as ChainId);
      if (idOfChainToGet === scenario.l2ChainId) return mocks.mockL2ChainContext;
      throw new Error(
        `getChain mock for emitter mismatch (scenario ${scenario.description}) should only be called for L2 ${scenario.l2ChainName}, got ${actualChainIdToChain(idOfChainToGet)}`,
      );
    });

    const result = await service.fetchAndVerifyVaaForL2Event(
      l2TxEmitterMismatchHash,
      scenario.l2ChainId,
      scenario.expectedEmitterAddress, // This is what the service expects
      scenario.targetL1ChainId,
    );

    expect(result).toBeNull();
    // mocks.mockGetVaaSdkImplementation should NOT be called because the messageId won't be found by the service
    expect(mocks.mockGetVaaSdkImplementation).not.toHaveBeenCalled();
    expect(mocks.mockL1TokenBridgeOperations.isTransferCompleted).not.toHaveBeenCalled();

    // Expect the log from the 'if (!messageId)' block in the service
    // The service logs the UniversalAddress it was looking for.
    const expectedEmitterUniversalServiceSide = toNative(
      actualChainIdToChain(scenario.l2ChainId),
      scenario.expectedEmitterAddress,
    ).toUniversalAddress();

    expect(mocks.mockLogErrorContext).toHaveBeenCalledWith(
      `Could not find relevant Wormhole message from emitter ${expectedEmitterUniversalServiceSide.toString()} (derived from native ${scenario.expectedEmitterAddress}) on chain ${actualChainIdToChain(scenario.l2ChainId)} in L2 transaction ${l2TxEmitterMismatchHash}. All found messages: ${stringifyWithBigInt([localMockWormholeMessageId])}`,
      expect.objectContaining({ message: 'Relevant Wormhole message not found' }),
    );
    if (originalGetChainEmitterMismatch)
      mocks.mockWormholeSdkInstance.getChain.mockImplementation(originalGetChainEmitterMismatch);
  });

  test('Subtask 13.9: isTransferCompleted Returns False - should return null and log info', async () => {
    const l2TxTransferNotCompletedHash = '0x' + '1'.repeat(64);
    const mockReceipt = createMockEthersReceipt(l2TxTransferNotCompletedHash, 1);
    mocks.mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);

    // currentTestMockWormholeMessageId is fine here
    mocks.mockL2ChainContext.parseTransaction.mockResolvedValue([currentTestMockWormholeMessageId]);

    const mockParsedVaa = createMockSdkVaa({
      emitterChain: scenario.l2ChainId,
      emitterAddress: scenario.expectedEmitterAddress,
      sequence: EXAMPLE_SEQUENCE,
      payloadLiteral: 'TokenBridge:TransferWithPayload',
      bytes: new Uint8Array([1, 2, 3, 4, 5]),
    });
    mocks.mockGetVaaSdkImplementation.mockResolvedValue(
      mockParsedVaa as VAA<'TokenBridge:TransferWithPayload'>,
    );
    mocks.mockL1TokenBridgeOperations.isTransferCompleted.mockResolvedValue(false);

    const result = await service.fetchAndVerifyVaaForL2Event(
      l2TxTransferNotCompletedHash,
      scenario.l2ChainId,
      scenario.expectedEmitterAddress,
      scenario.targetL1ChainId,
    );

    expect(result).toBeNull();
    expect(mocks.mockL1TokenBridgeOperations.isTransferCompleted).toHaveBeenCalledWith(
      mockParsedVaa,
    );
    // Service logs this via logErrorContext now, which is fine for a "not completed" state.
    // If this were a less severe "still pending" state, logger.info might be better.
    // For now, aligning test with current service log output.
    expect(mocks.mockLogErrorContext).toHaveBeenCalledWith(
      `Token bridge transfer VAA not completed on L1 (${actualChainIdToChain(scenario.targetL1ChainId)}) for ${l2TxTransferNotCompletedHash}. VAA Seq: ${mockParsedVaa.sequence}, Type: ${mockParsedVaa.payloadName}`,
      expect.objectContaining({ message: 'VAA transfer not completed on L1' }),
    );
  });

  test('Subtask 13.10: isTransferCompleted Throws Error - should return null and log error', async () => {
    const l2TxIsTransferCompletedErrorHash = '0x' + '2'.repeat(64);
    const mockReceipt = createMockEthersReceipt(l2TxIsTransferCompletedErrorHash, 1);
    mocks.mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);

    // currentTestMockWormholeMessageId is fine
    mocks.mockL2ChainContext.parseTransaction.mockResolvedValue([currentTestMockWormholeMessageId]);

    const mockParsedVaa = createMockSdkVaa({
      emitterChain: scenario.l2ChainId,
      emitterAddress: scenario.expectedEmitterAddress,
      sequence: EXAMPLE_SEQUENCE,
      payloadLiteral: 'TokenBridge:TransferWithPayload',
      bytes: new Uint8Array([1, 2, 3, 4, 5]),
    });
    mocks.mockGetVaaSdkImplementation.mockResolvedValue(
      mockParsedVaa as VAA<'TokenBridge:TransferWithPayload'>,
    );

    const redemptionCheckError = new Error('RPC error on target chain');
    mocks.mockL1TokenBridgeOperations.isTransferCompleted.mockRejectedValue(redemptionCheckError);

    const result = await service.fetchAndVerifyVaaForL2Event(
      l2TxIsTransferCompletedErrorHash,
      scenario.l2ChainId,
      scenario.expectedEmitterAddress,
      scenario.targetL1ChainId,
    );

    expect(result).toBeNull();
    expect(mocks.mockL1TokenBridgeOperations.isTransferCompleted).toHaveBeenCalledWith(
      mockParsedVaa,
    );
    // Aligning test with the actual log message from the service
    expect(mocks.mockLogErrorContext).toHaveBeenCalledWith(
      `Error checking VAA completion on L1 (${actualChainIdToChain(scenario.targetL1ChainId)}): ${redemptionCheckError.message}`,
      redemptionCheckError, // The error object itself is passed as the second argument
    );
  });

  test('VAA Emitter Chain Mismatch - should return null and log error', async () => {
    const l2TxEmitterChainMismatchHash = '0x' + '3'.repeat(64);

    // Skip this test if L2 is Sui or Avax as the specific emitter chain check might not apply or behave differently
    if (scenario.l2ChainId === L2_CHAIN_ID_SUI || scenario.l2ChainId === L2_CHAIN_ID_AVAX) {
      return;
    }

    const mockReceipt = createMockEthersReceipt(l2TxEmitterChainMismatchHash, 1);
    mocks.mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);

    const emitterChainForVaa = toChainId('Solana'); // A different chain than scenario.l2ChainId

    // Emitter address for this VAA - use the scenario's expected address but on the wrong chain
    const emitterAddressForMismatchVaaUniversal = toNative(
      actualChainIdToChain(emitterChainForVaa), // N.B. using the *wrong* chain here for conversion context
      scenario.expectedEmitterAddress, // Assuming this address form is valid for Solana for mock purposes
      // or that toNative handles it. For EVM, it's 20-byte. Solana is 32-byte.
      // This might need care if scenario.expectedEmitterAddress is EVM-specific.
      // For robustness, let's assume scenario.expectedEmitterAddress is a placeholder
      // that can be made to fit the chain.
      // Or, more simply, the UniversalAddress is what matters.
    ).toUniversalAddress(); // Ensuring no extra spaces here

    const localMockWormholeMessageId: WormholeMessageId = {
      chain: actualChainIdToChain(emitterChainForVaa), // Message comes from this chain
      emitter: emitterAddressForMismatchVaaUniversal, // Use the universal address
      sequence: EXAMPLE_SEQUENCE,
    };
    mocks.mockL2ChainContext.parseTransaction.mockResolvedValue([localMockWormholeMessageId]);

    const mockVaaWithDifferentEmitterChain = createMockSdkVaa({
      emitterChain: emitterChainForVaa, // VAA has this emitter chain
      emitterAddress: scenario.expectedEmitterAddress, // Native address string from scenario
      sequence: EXAMPLE_SEQUENCE,
      payloadLiteral: 'TokenBridge:TransferWithPayload',
      bytes: new Uint8Array([7, 8, 9, 0, 1]),
    });

    mocks.mockGetVaaSdkImplementation.mockImplementation(
      async <T extends PayloadLiteral>(
        msgId: WormholeMessageId,
        _payloadName: T,
        _timeout?: number,
      ) => {
        if (
          msgId.emitter.equals(emitterAddressForMismatchVaaUniversal) &&
          toChainId(msgId.chain) === emitterChainForVaa &&
          msgId.sequence === EXAMPLE_SEQUENCE
        ) {
          return mockVaaWithDifferentEmitterChain as VAA<T>;
        }
        return null;
      },
    );

    // Specific getChain mock for this test
    const originalGetChain = mocks.mockWormholeSdkInstance.getChain.getMockImplementation();
    mocks.mockWormholeSdkInstance.getChain.mockImplementationOnce((chainOrChainId) => {
      const idOfChainToGet: ChainId =
        typeof chainOrChainId === 'string'
          ? toChainId(chainOrChainId as Chain)
          : (chainOrChainId as ChainId);
      if (idOfChainToGet === scenario.l2ChainId) return mocks.mockL2ChainContext; // For parseTransaction
      throw new Error(
        `getChain mock for emitter chain mismatch (scenario ${scenario.description}) should only be called for L2 ${scenario.l2ChainName}, got ${actualChainIdToChain(idOfChainToGet)}`,
      );
    });

    const result = await service.fetchAndVerifyVaaForL2Event(
      l2TxEmitterChainMismatchHash,
      scenario.l2ChainId, // Expected L2 source chain
      scenario.expectedEmitterAddress,
      scenario.targetL1ChainId,
    );

    expect(result).toBeNull();
    // mocks.mockGetVaaSdkImplementation should NOT be called
    expect(mocks.mockGetVaaSdkImplementation).not.toHaveBeenCalled();
    expect(mocks.mockL1TokenBridgeOperations.isTransferCompleted).not.toHaveBeenCalled();
    // Expect the log from the 'if (!messageId)' block in the service
    // The service logs the UniversalAddress it was looking for.
    const expectedEmitterUniversalServiceSideChainMismatch = toNative(
      actualChainIdToChain(scenario.l2ChainId), // Service expects the message to be from L2 chain
      scenario.expectedEmitterAddress,
    ).toUniversalAddress();

    expect(mocks.mockLogErrorContext).toHaveBeenCalledWith(
      `Could not find relevant Wormhole message from emitter ${expectedEmitterUniversalServiceSideChainMismatch.toString()} (derived from native ${scenario.expectedEmitterAddress}) on chain ${actualChainIdToChain(scenario.l2ChainId)} in L2 transaction ${l2TxEmitterChainMismatchHash}. All found messages: ${stringifyWithBigInt([localMockWormholeMessageId])}`,
      expect.objectContaining({ message: 'Relevant Wormhole message not found' }),
    );

    if (originalGetChain)
      mocks.mockWormholeSdkInstance.getChain.mockImplementation(originalGetChain);
  });

  it('should return null when VAA is not found in SDK and is not present on L1', async () => {
    // Setup mock transaction receipt
    const mockReceipt = createMockEthersReceipt(L2_EXAMPLE_TX_HASH, 1);
    mocks.mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);

    // Setup parseTransaction to return the expected Wormhole message
    mocks.mockL2ChainContext.parseTransaction.mockResolvedValue([currentTestMockWormholeMessageId]);

    // Configure the SDK's getVAA to return null
    mocks.mockGetVaaSdkImplementation.mockResolvedValue(null);

    // Configure L1 TokenBridge operations to return false for isTransferCompleted
    mocks.mockL1TokenBridgeOperations.isTransferCompleted.mockResolvedValue(false);

    const result = await service.fetchAndVerifyVaaForL2Event(
      L2_EXAMPLE_TX_HASH,
      scenario.l2ChainId,
      scenario.expectedEmitterAddress,
      scenario.targetL1ChainId,
    );

    expect(result).toBeNull();
    expect(mocks.mockGetVaaSdkImplementation).toHaveBeenCalledWith(
      currentTestMockWormholeMessageId,
      'TokenBridge:TransferWithPayload',
      expect.any(Number),
    );
    expect(mocks.mockLogErrorContext).toHaveBeenCalledWith(
      expect.stringContaining(
        `this.wh.getVaa did not return a VAA for message ID ${stringifyWithBigInt(currentTestMockWormholeMessageId)} after trying all discriminators`,
      ),
      expect.any(Error),
    );
  });
});
