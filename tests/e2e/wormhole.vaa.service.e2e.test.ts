// tests/e2e/wormhole.vaa.service.e2e.test.ts - E2E tests for WormholeVaaService
//
// This suite tests the WormholeVaaService integration and edge cases using SDK mocks and real scenarios.
// It covers VAA fetching, verification, protocol/payload handling, and error conditions.

/* eslint-disable @typescript-eslint/consistent-type-imports */
process.env.USE_REAL_WORMHOLE_SERVICE = 'true'; // Signal global setup to NOT mock WormholeVaaService

import { jest } from '@jest/globals'; // Keep this for jest.fn
import { toNative } from '@wormhole-foundation/sdk-connect';
import {
  type ChainId,
  type Chain,
  chainIdToChain as actualChainIdToChain,
  toChainId,
} from '@wormhole-foundation/sdk';

import {
  setupWormholeMocksAndService,
  createMockEthersReceipt,
  createMockSdkVaa,
  coreSdkMethodMocks,
  MockedWormholeInstances,
} from './utils/wormhole.e2e.test.utils.js';

import { describe, test, expect, beforeEach } from '@jest/globals';

import { type WormholeVaaService } from '../../services/WormholeVaaService.js';
import {
  type VAA,
  type WormholeMessageId,
  UniversalAddress as _ActualUniversalAddress,
  type PayloadLiteral,
} from '@wormhole-foundation/sdk';
import { stringifyWithBigInt } from '../../utils/Numbers.js';
import {
  testScenarios,
  L2_CHAIN_ID_SUI,
  L2_CHAIN_ID_AVAX,
  TEST_NETWORK,
} from '../data/wormhole.e2e.scenarios.js';

describe.each(testScenarios)('WormholeVaaService E2E for $description (SDK mocks)', (scenario) => {
  let service: WormholeVaaService;
  let mocks: MockedWormholeInstances;
  let mockedSdkDeserialize: jest.Mock;
  let currentTestMockWormholeMessageId: WormholeMessageId;

  beforeEach(async () => {
    jest.clearAllMocks();
    mocks = await setupWormholeMocksAndService(scenario, TEST_NETWORK);
    service = mocks.wormholeVaaService;
    mockedSdkDeserialize = coreSdkMethodMocks.deserialize;
    mockedSdkDeserialize.mockReset();
    const emitterUniversalForTest = toNative(
      actualChainIdToChain(scenario.l2ChainId),
      scenario.expectedEmitterAddress,
    ).toUniversalAddress();
    currentTestMockWormholeMessageId = {
      chain: actualChainIdToChain(scenario.l2ChainId),
      emitter: emitterUniversalForTest,
      sequence: EXAMPLE_SEQUENCE,
    };
  });

  const L2_EXAMPLE_TX_HASH = '0x' + 'a'.repeat(64);
  const EXAMPLE_SEQUENCE = BigInt(123); // Centralized definition

  test('Subtask 13.1 & 13.4: Successfully fetches and verifies a VAA (VAA with .bytes)', async () => {
    const mockReceipt = createMockEthersReceipt(L2_EXAMPLE_TX_HASH, 1);
    mocks.mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);

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
    mocks.mockL1TokenBridgeOperations.isTransferCompleted.mockResolvedValue(true);

    mockedSdkDeserialize.mockImplementation((_bytesArg: unknown, _payloadArg: unknown) => {
      const areByteArraysEqual = (a: Uint8Array, b: Uint8Array) => {
        if (!a || !b || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
          if (a[i] !== b[i]) return false;
        }
        return true;
      };
      if (!areByteArraysEqual(_bytesArg as Uint8Array, mockVaaBytes)) {
        return null;
      }
      if (_payloadArg === 'TokenBridge:TransferWithPayload') {
        return mockParsedVaa as VAA<'TokenBridge:TransferWithPayload'>;
      }
      return null;
    });

    const result = await service.fetchAndVerifyVaaForL2Event(
      L2_EXAMPLE_TX_HASH,
      scenario.l2ChainId,
      scenario.expectedEmitterAddress,
      scenario.targetL1ChainId,
    );

    expect(result).not.toBeNull();
    expect(result?.vaaBytes).toEqual(mockVaaBytes);
    expect(result?.parsedVaa).toBe(mockParsedVaa);
    expect(mocks.mockL2Provider.getTransactionReceipt).toHaveBeenCalledWith(L2_EXAMPLE_TX_HASH);
    expect(mocks.mockL2ChainContext.parseTransaction).toHaveBeenCalledWith(L2_EXAMPLE_TX_HASH);
    expect(mocks.mockGetVaaSdkImplementation).toHaveBeenCalledWith(
      currentTestMockWormholeMessageId,
      'TokenBridge:TransferWithPayload',
      expect.any(Number),
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
    expect(mocks.mockLogErrorContext).not.toHaveBeenCalled();
  });

  test('Subtask 13.7: Handles VAA not found from SDK (getVaa returns null for both types)', async () => {
    const l2TxHashNotFound = '0x' + 'b'.repeat(64);
    const sequenceNotFound = BigInt(124);

    const emitterUniversalForNotFoundTest = toNative(
      actualChainIdToChain(scenario.l2ChainId),
      scenario.expectedEmitterAddress,
    ).toUniversalAddress();

    const localMockWormholeMessageId: WormholeMessageId = {
      chain: actualChainIdToChain(scenario.l2ChainId),
      emitter: emitterUniversalForNotFoundTest,
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
      localMockWormholeMessageId,
      'TokenBridge:TransferWithPayload',
      expect.any(Number),
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
    const EXAMPLE_SEQUENCE_SERIALIZE_TEST = BigInt(124);

    const mockReceipt = createMockEthersReceipt(l2TxHashForSerializeTest, 1);
    mocks.mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);

    const emitterUniversalForSerializeTest = toNative(
      actualChainIdToChain(scenario.l2ChainId),
      scenario.expectedEmitterAddress,
    ).toUniversalAddress();

    const whMessageIdForParseTxMockSerialize: WormholeMessageId = {
      chain: actualChainIdToChain(scenario.l2ChainId),
      emitter: emitterUniversalForSerializeTest,
      sequence: EXAMPLE_SEQUENCE_SERIALIZE_TEST,
    };
    mocks.mockL2ChainContext.parseTransaction.mockResolvedValue([
      whMessageIdForParseTxMockSerialize,
    ]);

    const mockSerializedBytes = new Uint8Array([5, 4, 3, 2, 1]);
    const mockVaaToSerialize = createMockSdkVaa<'TokenBridge:Transfer'>({
      emitterChain: scenario.l2ChainId,
      emitterAddress: scenario.expectedEmitterAddress,
      sequence: EXAMPLE_SEQUENCE_SERIALIZE_TEST,
      payloadLiteral: 'TokenBridge:Transfer',
      serialize: jest.fn(() => mockSerializedBytes),
      consistencyLevel: 0,
    });

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
        return null;
      },
    );

    mockedSdkDeserialize.mockImplementation((_discriminator: unknown, _bytesArg: unknown) => {
      const areByteArraysEqual = (a: Uint8Array, b: Uint8Array) => {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
          if (a[i] !== b[i]) return false;
        }
        return true;
      };
      if (areByteArraysEqual(mockSerializedBytes, _bytesArg as Uint8Array)) {
        return mockVaaToSerialize as VAA<'TokenBridge:Transfer'>;
      }
      return null;
    });

    const specificMockIsTransferCompleted =
      jest.fn<MockedWormholeInstances['mockL1TokenBridgeOperations']['isTransferCompleted']>();
    mocks.mockL1TokenBridgeOperations.isTransferCompleted.mockImplementation(
      specificMockIsTransferCompleted,
    );
    specificMockIsTransferCompleted.mockResolvedValue(true);

    const result = await service.fetchAndVerifyVaaForL2Event(
      l2TxHashForSerializeTest,
      scenario.l2ChainId,
      scenario.expectedEmitterAddress,
      scenario.targetL1ChainId,
    );

    expect(result).not.toBeNull();
    expect(result?.vaaBytes).toEqual(mockSerializedBytes);
    expect(result?.parsedVaa).toBe(mockVaaToSerialize);

    expect(mocks.mockL1ChainContext.getTokenBridge).toHaveBeenCalledTimes(1);
    expect(mocks.mockL2ChainContext.parseTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.mockGetVaaSdkImplementation).toHaveBeenCalledTimes(1);

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
      expect.stringMatching(
        new RegExp(
          `^L2 transaction ${l2TxRevertedHash} failed \\(reverted\\), cannot fetch VAA\\. Receipt: \\{.*\\}$`,
          's',
        ),
      ),
      expect.any(Error),
    );
  });

  test('Subtask 13.6: No Wormhole Message from parseTransaction - should return null and log info', async () => {
    const l2TxNoMessageHash = '0x' + 'd'.repeat(64);
    const mockReceipt = createMockEthersReceipt(l2TxNoMessageHash, 1);
    mocks.mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);
    mocks.mockL2ChainContext.parseTransaction.mockResolvedValue([]);

    coreSdkMethodMocks.getChain.mockImplementationOnce((chainOrChainId: any) => {
      const idOfChainToGet: ChainId =
        typeof chainOrChainId === 'string'
          ? toChainId(chainOrChainId as Chain)
          : (chainOrChainId as ChainId);
      if (idOfChainToGet === scenario.l2ChainId) {
        return mocks.mockL2ChainContext;
      }
      if (idOfChainToGet === scenario.targetL1ChainId) {
        return mocks.mockL1ChainContext;
      }
      throw new Error(
        `getChain mock for parseTransaction test (scenario ${scenario.description}) called with unexpected chain ${actualChainIdToChain(idOfChainToGet)}. Expected L2: ${scenario.l2ChainName} or L1: ${actualChainIdToChain(scenario.targetL1ChainId as ChainId)}`,
      );
    });

    const result = await service.fetchAndVerifyVaaForL2Event(
      l2TxNoMessageHash,
      scenario.l2ChainId,
      scenario.expectedEmitterAddress,
      scenario.targetL1ChainId,
    );

    expect(result).toBeNull();
    expect(mocks.mockLogErrorContext).toHaveBeenCalledWith(
      `No Wormhole messages found in L2 transaction ${l2TxNoMessageHash}. Chain: ${scenario.l2ChainName}.`,
      expect.any(Error),
    );
  });

  test('Subtask 13.8: VAA emitter address mismatch', async () => {
    const l2TxEmitterMismatchHash = '0x' + 'e'.repeat(64);
    const vaaEmitterAddressNative = '0x' + 'f'.repeat(40);

    const vaaEmitterUniversalDifferent = toNative(
      actualChainIdToChain(scenario.l2ChainId),
      vaaEmitterAddressNative,
    ).toUniversalAddress();

    const mockReceipt = createMockEthersReceipt(l2TxEmitterMismatchHash, 1);
    mocks.mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);

    const localMockWormholeMessageId: WormholeMessageId = {
      chain: actualChainIdToChain(scenario.l2ChainId),
      emitter: vaaEmitterUniversalDifferent,
      sequence: EXAMPLE_SEQUENCE,
    };
    mocks.mockL2ChainContext.parseTransaction.mockResolvedValue([localMockWormholeMessageId]);

    const mockVaaWithDifferentEmitter = createMockSdkVaa({
      emitterChain: scenario.l2ChainId,
      emitterAddress: vaaEmitterAddressNative,
      sequence: EXAMPLE_SEQUENCE,
      payloadLiteral: 'TokenBridge:TransferWithPayload',
      bytes: new Uint8Array([6, 7, 8, 9, 0]),
    });

    mocks.mockGetVaaSdkImplementation.mockImplementation(
      async <T extends PayloadLiteral>(
        msgId: WormholeMessageId,
        _payloadName: T,
        _timeout?: number,
      ) => {
        if (
          msgId.emitter.equals(vaaEmitterUniversalDifferent) &&
          msgId.sequence === EXAMPLE_SEQUENCE
        ) {
          return mockVaaWithDifferentEmitter as VAA<T>;
        }
        return null;
      },
    );

    coreSdkMethodMocks.getChain.mockImplementationOnce((chainOrChainId: any) => {
      const idOfChainToGet: ChainId =
        typeof chainOrChainId === 'string'
          ? toChainId(chainOrChainId as Chain)
          : (chainOrChainId as ChainId);
      if (idOfChainToGet === scenario.l2ChainId) {
        return mocks.mockL2ChainContext;
      }
      if (idOfChainToGet === scenario.targetL1ChainId) {
        return mocks.mockL1ChainContext;
      }
      throw new Error(
        `getChain mock for emitter mismatch (scenario ${scenario.description}) called with unexpected chain ${actualChainIdToChain(idOfChainToGet)}. Expected L2: ${scenario.l2ChainName} or L1: ${actualChainIdToChain(scenario.targetL1ChainId as ChainId)}`,
      );
    });

    const result = await service.fetchAndVerifyVaaForL2Event(
      l2TxEmitterMismatchHash,
      scenario.l2ChainId,
      scenario.expectedEmitterAddress,
      scenario.targetL1ChainId,
    );

    expect(result).toBeNull();
    expect(mocks.mockGetVaaSdkImplementation).not.toHaveBeenCalled();
    expect(mocks.mockL1TokenBridgeOperations.isTransferCompleted).not.toHaveBeenCalled();

    const expectedEmitterUniversalServiceSide = toNative(
      actualChainIdToChain(scenario.l2ChainId),
      scenario.expectedEmitterAddress,
    ).toUniversalAddress();

    expect(mocks.mockLogErrorContext).toHaveBeenCalledWith(
      `Could not find relevant Wormhole message from emitter ${expectedEmitterUniversalServiceSide.toString()} (derived from native ${scenario.expectedEmitterAddress}) on chain ${actualChainIdToChain(scenario.l2ChainId)} in L2 transaction ${l2TxEmitterMismatchHash}. All found messages: ${stringifyWithBigInt([localMockWormholeMessageId])}`,
      expect.objectContaining({ message: 'Relevant Wormhole message not found' }),
    );
  });

  test('Subtask 13.9: isTransferCompleted Returns False - should return null and log info', async () => {
    const l2TxTransferNotCompletedHash = '0x' + '1'.repeat(64);
    const mockReceipt = createMockEthersReceipt(l2TxTransferNotCompletedHash, 1);
    mocks.mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);

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
    mocks.mockL1TokenBridgeOperations.isTransferCompleted.mockImplementation(() =>
      Promise.resolve(false),
    );

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
    expect(mocks.mockLogErrorContext).toHaveBeenCalledWith(
      `Token bridge transfer VAA not completed on L1 (${actualChainIdToChain(scenario.targetL1ChainId)}) for ${l2TxTransferNotCompletedHash}. VAA Seq: ${mockParsedVaa.sequence}, Type: ${mockParsedVaa.payloadName}`,
      expect.objectContaining({ message: 'VAA transfer not completed on L1' }),
    );
  });

  test('Subtask 13.10: isTransferCompleted Throws Error - should return null and log error', async () => {
    const l2TxIsTransferCompletedErrorHash = '0x' + '2'.repeat(64);
    const mockReceipt = createMockEthersReceipt(l2TxIsTransferCompletedErrorHash, 1);
    mocks.mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);

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
    expect(mocks.mockLogErrorContext).toHaveBeenCalledWith(
      `Error checking VAA completion on L1 (${actualChainIdToChain(scenario.targetL1ChainId)}): ${redemptionCheckError.message}`,
      redemptionCheckError,
    );
  });

  test('VAA Emitter Chain Mismatch - should return null and log error', async () => {
    const l2TxEmitterChainMismatchHash = '0x' + '3'.repeat(64);

    if (scenario.l2ChainId === L2_CHAIN_ID_SUI || scenario.l2ChainId === L2_CHAIN_ID_AVAX) {
      return;
    }

    const mockReceipt = createMockEthersReceipt(l2TxEmitterChainMismatchHash, 1);
    mocks.mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);

    const emitterChainForVaa = toChainId('Solana');

    const emitterAddressForMismatchVaaUniversal = toNative(
      actualChainIdToChain(emitterChainForVaa),
      scenario.expectedEmitterAddress,
    ).toUniversalAddress();

    const localMockWormholeMessageId: WormholeMessageId = {
      chain: actualChainIdToChain(emitterChainForVaa),
      emitter: emitterAddressForMismatchVaaUniversal,
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

    coreSdkMethodMocks.getChain.mockImplementationOnce((chainOrChainId: any) => {
      const idOfChainToGet: ChainId =
        typeof chainOrChainId === 'string'
          ? toChainId(chainOrChainId as Chain)
          : (chainOrChainId as ChainId);
      if (idOfChainToGet === scenario.l2ChainId) {
        return mocks.mockL2ChainContext;
      }
      if (idOfChainToGet === scenario.targetL1ChainId) {
        return mocks.mockL1ChainContext;
      }
      throw new Error(
        `getChain mock for emitter chain mismatch (scenario ${scenario.description}) called with unexpected chain ${actualChainIdToChain(idOfChainToGet)}. Expected L2: ${scenario.l2ChainName} or L1: ${actualChainIdToChain(scenario.targetL1ChainId as ChainId)}`,
      );
    });

    const result = await service.fetchAndVerifyVaaForL2Event(
      l2TxEmitterChainMismatchHash,
      scenario.l2ChainId,
      scenario.expectedEmitterAddress,
      scenario.targetL1ChainId,
    );

    expect(result).toBeNull();
    expect(mocks.mockGetVaaSdkImplementation).not.toHaveBeenCalled();
    expect(mocks.mockL1TokenBridgeOperations.isTransferCompleted).not.toHaveBeenCalled();

    const expectedEmitterUniversalServiceSideChainMismatch = toNative(
      actualChainIdToChain(scenario.l2ChainId),
      scenario.expectedEmitterAddress,
    ).toUniversalAddress();

    expect(mocks.mockLogErrorContext).toHaveBeenCalledWith(
      `Could not find relevant Wormhole message from emitter ${expectedEmitterUniversalServiceSideChainMismatch.toString()} (derived from native ${scenario.expectedEmitterAddress}) on chain ${actualChainIdToChain(scenario.l2ChainId)} in L2 transaction ${l2TxEmitterChainMismatchHash}. All found messages: ${stringifyWithBigInt([localMockWormholeMessageId])}`,
      expect.objectContaining({ message: 'Relevant Wormhole message not found' }),
    );
  });

  it('should return null when VAA is not found in SDK and is not present on L1', async () => {
    const mockReceipt = createMockEthersReceipt(L2_EXAMPLE_TX_HASH, 1);
    mocks.mockL2Provider.getTransactionReceipt.mockResolvedValue(mockReceipt);

    mocks.mockL2ChainContext.parseTransaction.mockResolvedValue([currentTestMockWormholeMessageId]);

    mocks.mockGetVaaSdkImplementation.mockResolvedValue(null);

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
