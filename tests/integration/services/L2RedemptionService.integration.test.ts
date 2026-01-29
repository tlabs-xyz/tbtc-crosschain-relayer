/**
 * Integration tests for L2RedemptionService collision retry scenarios.
 *
 * These tests verify component interaction between L1RedemptionHandler,
 * L2RedemptionService, and RedemptionStore for:
 * - Collision error handling (retryable errors from pending redemptions)
 * - Retry counting and exhaustion logic (max 10 attempts)
 * - Permanent error handling (VAA used, insufficient funds)
 * - Success path with transaction hash propagation
 * - End-to-end error message preservation
 */

import { ethers } from 'ethers';
import {
  RedemptionStatus,
  type Redemption,
  type RedemptionRequestedEventData,
} from '../../../types/Redemption.type.js';
import type { L1RelayResult } from '../../../interfaces/L1RedemptionHandler.interface.js';
import type { EvmChainConfig } from '../../../config/schemas/evm.chain.schema.js';

/**
 * Common error messages used across tests.
 * Centralizing these ensures consistency and makes maintenance easier.
 */
const ERROR_MESSAGES = {
  COLLISION: 'There is already a pending redemption for the given redeemer',
  VAA_ALREADY_EXECUTED: 'VAA was already executed',
  INSUFFICIENT_FUNDS: 'insufficient funds for gas * price + value',
} as const;

// Mock the Logger module to prevent console output during tests
jest.mock('../../../utils/Logger.js', () => ({
  __esModule: true,
  default: {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  },
  logErrorContext: jest.fn(),
}));

// Mock RedemptionStore - track all updates for integration assertions
const mockRedemptionStoreUpdate = jest.fn();
const mockRedemptionStoreGetByStatus = jest.fn();
const mockRedemptionStoreGetById = jest.fn();
const mockRedemptionStoreCreate = jest.fn();

jest.mock('../../../utils/RedemptionStore.js', () => ({
  RedemptionStore: {
    update: (...args: unknown[]) => mockRedemptionStoreUpdate(...args),
    getByStatus: (...args: unknown[]) => mockRedemptionStoreGetByStatus(...args),
    getById: (...args: unknown[]) => mockRedemptionStoreGetById(...args),
    create: (...args: unknown[]) => mockRedemptionStoreCreate(...args),
  },
}));

// Mock L1RedemptionHandler registry - this represents the integration with L1
const mockRelayRedemptionToL1 = jest.fn();
const mockHandlerInitialize = jest.fn();

jest.mock('../../../handlers/L1RedemptionHandlerRegistry.js', () => ({
  l1RedemptionHandlerRegistry: {
    get: jest.fn(() => ({
      config: {} as EvmChainConfig,
      initialize: mockHandlerInitialize,
      relayRedemptionToL1: mockRelayRedemptionToL1,
    })),
  },
}));

// Mock WormholeVaaService
jest.mock('../../../services/WormholeVaaService.js', () => ({
  WormholeVaaService: {
    create: jest.fn().mockResolvedValue({
      fetchVaaForRedemption: jest.fn(),
    }),
  },
}));

// Mock ethers provider
jest.mock('ethers', () => {
  const actualEthers = jest.requireActual('ethers');
  return {
    ...actualEthers,
    ethers: {
      ...actualEthers.ethers,
      providers: {
        JsonRpcProvider: jest.fn().mockImplementation(() => ({
          getBlockNumber: jest.fn().mockResolvedValue(1000),
          getBlock: jest.fn().mockResolvedValue({ timestamp: 1700000000 }),
          on: jest.fn(),
        })),
      },
      Contract: jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        removeAllListeners: jest.fn(),
        queryFilter: jest.fn().mockResolvedValue([]),
        filters: {
          RedemptionRequestedOnL2: jest.fn(),
        },
      })),
      BigNumber: actualEthers.BigNumber,
    },
  };
});

import { L2RedemptionService } from '../../../services/L2RedemptionService.js';
import { NETWORK, CHAIN_TYPE } from '../../../config/schemas/common.schema.js';

/**
 * Helper functions to create common L1RelayResult objects.
 * Extracted to reduce duplication and improve test readability.
 */
const createCollisionResult = (errorMessage = ERROR_MESSAGES.COLLISION): L1RelayResult => ({
  success: false,
  error: errorMessage,
  isRetryable: true,
});

const createPermanentErrorResult = (errorMessage: string): L1RelayResult => ({
  success: false,
  error: errorMessage,
  isRetryable: false,
});

const createSuccessResult = (txHash: string): L1RelayResult => ({
  success: true,
  txHash,
  isRetryable: false,
});

/**
 * Extracts the updated redemption from the mock store update call.
 * Common pattern across all tests - centralizing improves maintainability.
 */
const getUpdatedRedemption = (): Redemption => {
  expect(mockRedemptionStoreUpdate).toHaveBeenCalledTimes(1);
  return mockRedemptionStoreUpdate.mock.calls[0][0] as Redemption;
};

describe('L2RedemptionService Integration Tests', () => {
  let service: L2RedemptionService;
  let mockChainConfig: EvmChainConfig;

  /**
   * Creates a mock redemption with sensible defaults for integration testing.
   * Mirrors the structure expected by L2RedemptionService.processVaaFetchedRedemptions().
   *
   * @param overrides - Partial redemption fields to override defaults
   * @returns Complete Redemption object with VAA_FETCHED status
   */
  const createMockRedemption = (overrides: Partial<Redemption> = {}): Redemption => {
    const now = Date.now();
    return {
      id: '0xabc123def456',
      chainId: 'BaseSepolia',
      event: {
        redeemerOutputScript: '0x76a914abcdef1234567890abcdef1234567890abcdef1234567890',
        amount: ethers.BigNumber.from('1000000'),
        l2TransactionHash: '0xabc123def456',
      } as RedemptionRequestedEventData,
      serializedVaaBytes: new Uint8Array([1, 2, 3, 4, 5]),
      vaaStatus: RedemptionStatus.VAA_FETCHED,
      l1SubmissionTxHash: null,
      status: RedemptionStatus.VAA_FETCHED,
      error: null,
      dates: {
        createdAt: now,
        vaaFetchedAt: now,
        l1SubmittedAt: null,
        completedAt: null,
        lastActivityAt: now,
      },
      logs: [],
      retryCount: 0,
      ...overrides,
    };
  };

  beforeAll(async () => {
    mockChainConfig = {
      chainName: 'BaseSepolia',
      chainType: CHAIN_TYPE.EVM,
      network: NETWORK.TESTNET,
      privateKey: '0x1234567890123456789012345678901234567890123456789012345678901234',
      l1Confirmations: 6,
      l1Rpc: 'http://l1-rpc.test',
      l2Rpc: 'http://l2-rpc.test',
      l2WsRpc: 'ws://l2-ws.test',
      l1BitcoinDepositorAddress: '0x1234567890123456789012345678901234567890',
      l1BitcoinDepositorStartBlock: 1000,
      l2BitcoinDepositorAddress: '0x2234567890123456789012345678901234567890',
      l2BitcoinDepositorStartBlock: 2000,
      l2BitcoinRedeemerAddress: '0x5234567890123456789012345678901234567890',
      l2BitcoinRedeemerStartBlock: 3000,
      l2WormholeGatewayAddress: '0x3234567890123456789012345678901234567890',
      l2WormholeChainId: 30,
      vaultAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      useEndpoint: false,
      enableL2Redemption: true,
    } as EvmChainConfig;

    service = await L2RedemptionService.create(mockChainConfig);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedemptionStoreGetByStatus.mockResolvedValue([]);
    mockRedemptionStoreUpdate.mockResolvedValue(undefined);
  });

  describe('Collision Retry Scenario', () => {
    it('should keep VAA_FETCHED and set retryCount = 1 when collision occurs', async () => {
      // Arrange: Redemption with retryCount = 0, SDK throws collision error
      const mockRedemption = createMockRedemption({ retryCount: 0 });

      mockRedemptionStoreGetByStatus.mockResolvedValue([mockRedemption]);
      mockRelayRedemptionToL1.mockResolvedValue(createCollisionResult());

      // Act: Process redemptions through the service
      await service.processVaaFetchedRedemptions();

      // Assert: Verify integration - status remains VAA_FETCHED, retryCount = 1
      const updatedRedemption = getUpdatedRedemption();

      expect(updatedRedemption.status).toBe(RedemptionStatus.VAA_FETCHED);
      expect(updatedRedemption.retryCount).toBe(1);
      expect(updatedRedemption.error).toContain('pending redemption');
    });

    it('should increment retryCount correctly on multiple collisions', async () => {
      // Arrange: Simulate multiple collision errors
      mockRelayRedemptionToL1.mockResolvedValue(createCollisionResult());

      // Test retry increment sequence: 0 -> 1 -> 2 -> 3
      const retrySequence = [
        { initial: 0, expected: 1 },
        { initial: 1, expected: 2 },
        { initial: 2, expected: 3 },
      ];

      for (const { initial, expected } of retrySequence) {
        jest.clearAllMocks();
        const redemption = createMockRedemption({ retryCount: initial });
        mockRedemptionStoreGetByStatus.mockResolvedValue([redemption]);

        await service.processVaaFetchedRedemptions();

        const updated = getUpdatedRedemption();
        expect(updated.retryCount).toBe(expected);
        expect(updated.status).toBe(RedemptionStatus.VAA_FETCHED);
      }
    });
  });

  describe('Retry Exhaustion', () => {
    it('should transition to FAILED when retryCount reaches 10 (max retries exceeded)', async () => {
      // Arrange: retryCount is 9, after increment it will be 10 triggering max retry failure
      const mockRedemption = createMockRedemption({ retryCount: 9 });

      mockRedemptionStoreGetByStatus.mockResolvedValue([mockRedemption]);
      mockRelayRedemptionToL1.mockResolvedValue(createCollisionResult());

      // Act
      await service.processVaaFetchedRedemptions();

      // Assert: Verify integration - retryCount = 10, status = FAILED, error mentions max retries
      const updatedRedemption = getUpdatedRedemption();

      expect(updatedRedemption.retryCount).toBe(10);
      expect(updatedRedemption.status).toBe(RedemptionStatus.FAILED);
      expect(updatedRedemption.error).toContain('Max retries');
      expect(updatedRedemption.error).toContain('10');
    });

    it('should stay VAA_FETCHED when retryCount is 8 (becomes 9, below max)', async () => {
      // Arrange: retryCount is 8, after increment it will be 9 (still below max 10)
      const mockRedemption = createMockRedemption({ retryCount: 8 });

      mockRedemptionStoreGetByStatus.mockResolvedValue([mockRedemption]);
      mockRelayRedemptionToL1.mockResolvedValue(createCollisionResult());

      // Act
      await service.processVaaFetchedRedemptions();

      // Assert: Verify integration - retryCount = 9, status remains VAA_FETCHED
      const updatedRedemption = getUpdatedRedemption();

      expect(updatedRedemption.retryCount).toBe(9);
      expect(updatedRedemption.status).toBe(RedemptionStatus.VAA_FETCHED);
      expect(updatedRedemption.error).not.toContain('Max retries');
    });
  });

  describe('Permanent Error', () => {
    it('should fail immediately when VAA was already executed', async () => {
      // Arrange: retryCount = 0, SDK throws "VAA was already executed" (permanent error)
      const mockRedemption = createMockRedemption({ retryCount: 0 });

      mockRedemptionStoreGetByStatus.mockResolvedValue([mockRedemption]);
      mockRelayRedemptionToL1.mockResolvedValue(
        createPermanentErrorResult(ERROR_MESSAGES.VAA_ALREADY_EXECUTED),
      );

      // Act
      await service.processVaaFetchedRedemptions();

      // Assert: Verify integration - status = FAILED immediately, retryCount unchanged
      const updatedRedemption = getUpdatedRedemption();

      expect(updatedRedemption.status).toBe(RedemptionStatus.FAILED);
      expect(updatedRedemption.retryCount).toBe(0); // Not incremented for permanent errors
      expect(updatedRedemption.error).toContain(ERROR_MESSAGES.VAA_ALREADY_EXECUTED);
    });

    it('should fail immediately when insufficient funds for gas', async () => {
      // Arrange: SDK throws "insufficient funds" (permanent error)
      const mockRedemption = createMockRedemption({ retryCount: 3 });

      mockRedemptionStoreGetByStatus.mockResolvedValue([mockRedemption]);
      mockRelayRedemptionToL1.mockResolvedValue(
        createPermanentErrorResult(ERROR_MESSAGES.INSUFFICIENT_FUNDS),
      );

      // Act
      await service.processVaaFetchedRedemptions();

      // Assert: Verify integration - status = FAILED immediately, retryCount unchanged
      const updatedRedemption = getUpdatedRedemption();

      expect(updatedRedemption.status).toBe(RedemptionStatus.FAILED);
      expect(updatedRedemption.retryCount).toBe(3); // Unchanged - not incremented
      expect(updatedRedemption.error).toContain('insufficient funds');
    });
  });

  describe('Success Path', () => {
    it('should complete redemption with txHash on successful SDK response', async () => {
      // Arrange: SDK returns successful transaction
      const expectedTxHash = '0xsuccesstxhash123456789abcdef';
      const mockRedemption = createMockRedemption({ retryCount: 0 });

      mockRedemptionStoreGetByStatus.mockResolvedValue([mockRedemption]);
      mockRelayRedemptionToL1.mockResolvedValue(createSuccessResult(expectedTxHash));

      // Act
      await service.processVaaFetchedRedemptions();

      // Assert: Verify integration - status = COMPLETED, txHash set, error = null
      const updatedRedemption = getUpdatedRedemption();

      expect(updatedRedemption.status).toBe(RedemptionStatus.COMPLETED);
      expect(updatedRedemption.l1SubmissionTxHash).toBe(expectedTxHash);
      expect(updatedRedemption.error).toBeNull();
      expect(updatedRedemption.dates.completedAt).not.toBeNull();
      expect(updatedRedemption.dates.l1SubmittedAt).not.toBeNull();
    });
  });

  describe('Error Propagation', () => {
    it('should preserve error message through entire flow (end-to-end)', async () => {
      // Arrange: SDK throws error with specific message containing unique identifier
      const specificErrorMessage =
        'Custom error: transaction failed due to specific network condition XYZ-123';
      const mockRedemption = createMockRedemption({ retryCount: 0 });

      mockRedemptionStoreGetByStatus.mockResolvedValue([mockRedemption]);
      mockRelayRedemptionToL1.mockResolvedValue(createPermanentErrorResult(specificErrorMessage));

      // Act: Process through entire service flow
      await service.processVaaFetchedRedemptions();

      // Assert: Verify integration - original error message preserved in stored redemption
      const updatedRedemption = getUpdatedRedemption();

      // The error field should contain the original message from L1RedemptionHandler
      expect(updatedRedemption.error).toBe(specificErrorMessage);
      expect(updatedRedemption.error).toContain('XYZ-123');
    });
  });
});
