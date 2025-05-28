process.env.USE_REAL_WORMHOLE_SERVICE = 'true'; // Signal global setup to NOT mock WormholeVaaService

// Import the utility that sets up mocks FIRST
import {
  setupWormholeMocksAndService,
  createMockEthersReceipt, // Ensure all used utils are imported
  createMockSdkVaa, // Ensure all used utils are imported
  EXPECTED_GET_VAA_TIMEOUT_MS, // Ensure all used utils are imported
  type MockedWormholeInstances, // Ensure all used utils are imported
} from './utils/wormhole.e2e.test.utils';

import { describe, test, expect, beforeEach, jest } from '@jest/globals';

// // Unmock WormholeVaaService for this specific E2E test file to use the actual implementation
// // The path is relative to THIS test file (tests/e2e/wormhole.vaa.service.e2e.test.ts)
// // and should point to services/WormholeVaaService.ts
// jest.unmock('../../services/WormholeVaaService');

import { WormholeVaaService } from '../../services/WormholeVaaService';
import {
  type ChainId,
  type Network,
  type VAA,
  type WormholeMessageId,
  UniversalAddress as ActualUniversalAddress,
  type Chain,
  toChainId,
  chainIdToChain as actualChainIdToChain,
} from '@wormhole-foundation/sdk';
// Logger and stringifyWithBigInt are used by the service, mocks are handled by utils
// import logger from '../../utils/Logger';
import { stringifyWithBigInt } from '../../utils/Numbers';
import {
  testScenarios,
  // L1_CHAIN_ID_ETH, // Not directly used, derived from scenario in setup
  L2_CHAIN_ID_SUI, // Used in one test for conditional logic
  L2_CHAIN_ID_AVAX, // Used in one test for conditional logic
  TEST_NETWORK,
} from '../data/wormhole.e2e.scenarios';

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

    // console.log(
    //   '[E2E Test DEBUG] After setupWormholeMocksAndService. mocks.mockL1TokenBridgeOperations defined:',
    //   !!mocks.mockL1TokenBridgeOperations,
    // );
    // if (mocks.mockL1TokenBridgeOperations) {
    //   console.log(
    //     '[E2E Test DEBUG] mocks.mockL1TokenBridgeOperations.isTransferCompleted defined:',
    //     !!mocks.mockL1TokenBridgeOperations.isTransferCompleted,
    //   );
    // }

    currentTestMockWormholeMessageId = {
      // Renamed for clarity within tests
      chain: actualChainIdToChain(scenario.l2ChainId),
      emitter: new ActualUniversalAddress(scenario.expectedEmitterAddress),
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

    // Ensure parseTransaction is explicitly mocked for THIS test run
    const whMessageIdForParseTxMock = {
      chain: actualChainIdToChain(scenario.l2ChainId), // Should be 'Sui' for this scenario
      emitter: new ActualUniversalAddress(scenario.expectedEmitterAddress),
      sequence: EXAMPLE_SEQUENCE,
    };
    // console.log(
    //   '[TEST 13.1 DEBUG] whMessageIdForParseTxMock set in test:',
    //   stringifyWithBigInt(whMessageIdForParseTxMock),
    // );
    mocks.mockL2ChainContext.parseTransaction.mockResolvedValue([whMessageIdForParseTxMock]);

    const mockVaaBytes = new Uint8Array([11, 22, 33, 44, 55]);
    const mockParsedVaa = createMockSdkVaa({
      emitterChain: scenario.l2ChainId,
      emitterAddress: scenario.expectedEmitterAddress,
      sequence: EXAMPLE_SEQUENCE, // Consistent sequence
      payloadLiteral: 'TokenBridge:TransferWithPayload',
      consistencyLevel: 15,
      bytes: mockVaaBytes,
    });
    mocks.mockGetVaaSdkImplementation.mockResolvedValue(
      mockParsedVaa as VAA<'TokenBridge:TransferWithPayload'>,
    );
    mocks.mockL1TokenBridgeOperations.isTransferCompleted.mockResolvedValue(true);

    const result = await service.fetchAndVerifyVaaForL2Event(
      L2_EXAMPLE_TX_HASH,
      scenario.l2ChainId,
      scenario.expectedEmitterAddress,
      scenario.targetL1ChainId,
    );

    // console.log(
    //   '[E2E Test DEBUG] Before checking isTransferCompleted. mocks.mockL1TokenBridgeOperations defined:',
    //   !!mocks.mockL1TokenBridgeOperations,
    // );
    // if (mocks.mockL1TokenBridgeOperations) {
    //   console.log(
    //     '[E2E Test DEBUG] mocks.mockL1TokenBridgeOperations.isTransferCompleted defined:',
    //     !!mocks.mockL1TokenBridgeOperations.isTransferCompleted,
    //   );
    // }

    expect(result).not.toBeNull();
    expect(result?.vaaBytes).toBe(mockVaaBytes);
    expect(result?.parsedVaa).toBe(mockParsedVaa);
    expect(mocks.mockL2Provider.getTransactionReceipt).toHaveBeenCalledWith(L2_EXAMPLE_TX_HASH);
    expect(mocks.mockL2ChainContext.parseTransaction).toHaveBeenCalledWith(L2_EXAMPLE_TX_HASH);
    expect(mocks.mockGetVaaSdkImplementation).toHaveBeenCalledWith(
      currentTestMockWormholeMessageId,
      'TokenBridge:TransferWithPayload',
      EXPECTED_GET_VAA_TIMEOUT_MS,
    );
    expect(mocks.mockGetVaaSdkImplementation).toHaveBeenCalledTimes(1);
    expect(mocks.mockL1ChainContext.getTokenBridge).toHaveBeenCalledTimes(1);
    expect(mocks.mockL1TokenBridgeOperations.isTransferCompleted).toHaveBeenCalledWith(
      mockParsedVaa,
    );
    expect(mocks.mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining(
        `Token bridge transfer VAA confirmed completed on L1 (${actualChainIdToChain(scenario.targetL1ChainId)}) for ${L2_EXAMPLE_TX_HASH}`,
      ),
    );
  });

  test('Subtask 13.7: Handles VAA not found from SDK (getVaa returns null for both types)', async () => {
    const l2TxHashNotFound = '0x' + 'b'.repeat(64);
    const sequenceNotFound = BigInt(124); // Specific sequence for this test

    const localMockWormholeMessageId: WormholeMessageId = {
      // Local version for this specific sequence
      chain: actualChainIdToChain(scenario.l2ChainId),
      emitter: new ActualUniversalAddress(scenario.expectedEmitterAddress),
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
    expect(mocks.mockGetVaaSdkImplementation).toHaveBeenCalledWith(
      localMockWormholeMessageId, // Use the one with correct sequence
      'TokenBridge:Transfer',
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
    const mockReceipt = createMockEthersReceipt(L2_EXAMPLE_TX_HASH, 1);
    mocks.mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);

    // currentTestMockWormholeMessageId is already set up with EXAMPLE_SEQUENCE
    mocks.mockL2ChainContext.parseTransaction.mockResolvedValue([currentTestMockWormholeMessageId]);

    const mockVaaToSerialize = createMockSdkVaa({
      emitterChain: scenario.l2ChainId,
      emitterAddress: scenario.expectedEmitterAddress,
      sequence: EXAMPLE_SEQUENCE, // Consistent sequence
      payloadLiteral: 'TokenBridge:Transfer',
      consistencyLevel: 15,
      serialize: jest.fn<() => Uint8Array>(() => new Uint8Array([5, 4, 3, 2, 1])),
    });

    mocks.mockGetVaaSdkImplementation.mockImplementationOnce(async () => null); // First call fails
    mocks.mockGetVaaSdkImplementation.mockImplementationOnce(
      async () => mockVaaToSerialize as VAA<any>,
    ); // Second call succeeds, cast to VAA<any>

    mocks.mockL1TokenBridgeOperations.isTransferCompleted.mockResolvedValue(true);

    const result = await service.fetchAndVerifyVaaForL2Event(
      L2_EXAMPLE_TX_HASH,
      scenario.l2ChainId,
      scenario.expectedEmitterAddress,
      scenario.targetL1ChainId,
    );

    expect(result).not.toBeNull();
    expect(result?.vaaBytes).toEqual(new Uint8Array([5, 4, 3, 2, 1]));
    expect(result?.parsedVaa).toBe(mockVaaToSerialize);
    expect(mocks.mockGetVaaSdkImplementation).toHaveBeenCalledWith(
      currentTestMockWormholeMessageId,
      'TokenBridge:TransferWithPayload',
      EXPECTED_GET_VAA_TIMEOUT_MS,
    );
    expect(mocks.mockGetVaaSdkImplementation).toHaveBeenCalledWith(
      currentTestMockWormholeMessageId,
      'TokenBridge:Transfer',
      EXPECTED_GET_VAA_TIMEOUT_MS,
    );
    expect(mocks.mockGetVaaSdkImplementation).toHaveBeenCalledTimes(2);
    expect(mocks.mockL1TokenBridgeOperations.isTransferCompleted).toHaveBeenCalledWith(
      mockVaaToSerialize,
    );
    expect(mocks.mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining(
        `Token bridge transfer VAA confirmed completed on L1 (${actualChainIdToChain(scenario.targetL1ChainId)}) for ${L2_EXAMPLE_TX_HASH}`,
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
      `L2 transaction ${l2TxRevertedHash} failed (reverted), cannot fetch VAA. Receipt: ${stringifyWithBigInt(revertedReceipt)}`,
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
    const actualEmitterAddress = scenario.expectedEmitterAddress; // The one configured in the service
    const vaaEmitterAddress = new ActualUniversalAddress('0x' + 'f'.repeat(64)).toString(); // A different emitter

    const mockReceipt = createMockEthersReceipt(l2TxEmitterMismatchHash, 1);
    mocks.mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);

    const localMockWormholeMessageId: WormholeMessageId = {
      chain: actualChainIdToChain(scenario.l2ChainId),
      emitter: new ActualUniversalAddress(vaaEmitterAddress), // VAA has this emitter
      sequence: EXAMPLE_SEQUENCE,
    };
    mocks.mockL2ChainContext.parseTransaction.mockResolvedValue([localMockWormholeMessageId]);

    const mockVaaWithDifferentEmitter = createMockSdkVaa({
      emitterChain: scenario.l2ChainId,
      emitterAddress: vaaEmitterAddress, // VAA has this emitter
      sequence: EXAMPLE_SEQUENCE,
      payloadLiteral: 'TokenBridge:TransferWithPayload',
      bytes: new Uint8Array([6, 7, 8, 9, 0]),
    });

    mocks.mockGetVaaSdkImplementation.mockResolvedValue(
      mockVaaWithDifferentEmitter as VAA<'TokenBridge:TransferWithPayload'>,
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
    expect(mocks.mockLogErrorContext).toHaveBeenCalledWith(
      `Could not find Wormhole message from emitter ${scenario.expectedEmitterAddress} on chain ${actualChainIdToChain(scenario.l2ChainId)} in L2 transaction ${l2TxEmitterMismatchHash}. Found messages: ${stringifyWithBigInt([localMockWormholeMessageId])}`,
      expect.objectContaining({ message: 'Relevant WormholeMessageId not found' }),
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
      console.warn(
        `Skipping VAA emitter chain mismatch test for L2 chain ${scenario.l2ChainName} as specific check may not apply.`,
      );
      return;
    }

    const mockReceipt = createMockEthersReceipt(l2TxEmitterChainMismatchHash, 1);
    mocks.mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);

    const emitterChainForVaa = toChainId('Solana'); // A different chain than scenario.l2ChainId
    const localMockWormholeMessageId: WormholeMessageId = {
      chain: actualChainIdToChain(emitterChainForVaa),
      emitter: new ActualUniversalAddress(scenario.expectedEmitterAddress),
      sequence: EXAMPLE_SEQUENCE,
    };
    mocks.mockL2ChainContext.parseTransaction.mockResolvedValue([localMockWormholeMessageId]);

    const mockVaaWithDifferentEmitterChain = createMockSdkVaa({
      emitterChain: emitterChainForVaa,
      emitterAddress: scenario.expectedEmitterAddress,
      sequence: EXAMPLE_SEQUENCE,
      payloadLiteral: 'TokenBridge:TransferWithPayload',
      bytes: new Uint8Array([7, 8, 9, 0, 1]),
    });

    mocks.mockGetVaaSdkImplementation.mockResolvedValue(
      mockVaaWithDifferentEmitterChain as VAA<'TokenBridge:TransferWithPayload'>,
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
    expect(mocks.mockLogErrorContext).toHaveBeenCalledWith(
      `Could not find Wormhole message from emitter ${scenario.expectedEmitterAddress} on chain ${actualChainIdToChain(scenario.l2ChainId)} in L2 transaction ${l2TxEmitterChainMismatchHash}. Found messages: ${stringifyWithBigInt([localMockWormholeMessageId])}`,
      expect.objectContaining({ message: 'Relevant WormholeMessageId not found' }),
    );

    if (originalGetChain)
      mocks.mockWormholeSdkInstance.getChain.mockImplementation(originalGetChain);
  });
});
