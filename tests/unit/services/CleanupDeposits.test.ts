import { jest } from '@jest/globals';
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import type { Deposit } from '../../../types/Deposit.type.js';
import { DepositStatus } from '../../../types/DepositStatus.enum.js';

// Mock all dependencies before importing
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const mockLogDepositDeleted = jest.fn();

const mockDepositStore = {
  getByStatus: jest.fn() as jest.MockedFunction<any>,
  getById: jest.fn() as jest.MockedFunction<any>,
  delete: jest.fn() as jest.MockedFunction<any>,
};

jest.mock('../../../utils/Logger.js', () => ({
  __esModule: true,
  default: mockLogger,
  logErrorContext: jest.fn(),
}));

jest.mock('../../../utils/AuditLog.js', () => ({
  __esModule: true,
  logDepositDeleted: mockLogDepositDeleted,
}));

jest.mock('../../../utils/DepositStore.js', () => ({
  __esModule: true,
  DepositStore: mockDepositStore,
}));

// Test helper to create minimal deposit objects with required fields
const createTestDeposit = (overrides: Partial<Deposit> = {}): Deposit => ({
  id: 'test-deposit-id',
  chainName: 'testChain',
  fundingTxHash: 'mock-funding-tx-hash',
  outputIndex: 0,
  hashes: {
    btc: {
      btcTxHash: 'mock-btc-tx-hash',
    },
    eth: {
      initializeTxHash: null,
      finalizeTxHash: null,
    },
    solana: {
      bridgeTxHash: null,
    },
  },
  receipt: {
    depositor: 'mock-depositor',
    blindingFactor: 'mock-blinding',
    walletPublicKeyHash: 'mock-wallet',
    refundPublicKeyHash: 'mock-refund',
    refundLocktime: '1234567890',
    extraData: 'mock-extra',
  },
  owner: 'mock-owner',
  status: DepositStatus.QUEUED,
  L1OutputEvent: {
    fundingTx: {
      version: 'mock-version',
      inputVector: 'mock-input-vector',
      outputVector: 'mock-output-vector',
      locktime: 'mock-locktime',
    },
    reveal: {
      fundingOutputIndex: 0,
      blindingFactor: 'mock-blinding-factor',
      walletPubKeyHash: 'mock-wallet-pubkey',
      refundPubKeyHash: 'mock-refund-pubkey',
      refundLocktime: 'mock-refund-locktime',
      vault: 'mock-vault',
    },
    l2DepositOwner: 'mock-l2-owner',
    l2Sender: 'mock-l2-sender',
  },
  dates: {
    createdAt: Date.now() - 24 * 60 * 60 * 1000, // 1 day ago default (numeric timestamp)
    initializationAt: null,
    finalizationAt: null,
    awaitingWormholeVAAMessageSince: null,
    bridgedAt: null,
    lastActivityAt: Date.now(), // Current time (numeric timestamp)
  },
  wormholeInfo: {
    txHash: null,
    transferSequence: null,
    bridgingAttempted: false,
  },
  error: null,
  ...overrides,
});

describe('CleanupDeposits Unit Tests', () => {
  // Store original env vars
  const originalEnvVars = {
    CLEAN_QUEUED_TIME: process.env.CLEAN_QUEUED_TIME,
    CLEAN_FINALIZED_TIME: process.env.CLEAN_FINALIZED_TIME,
    CLEAN_BRIDGED_TIME: process.env.CLEAN_BRIDGED_TIME,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset env vars to undefined to test defaults
    delete process.env.CLEAN_QUEUED_TIME;
    delete process.env.CLEAN_FINALIZED_TIME;
    delete process.env.CLEAN_BRIDGED_TIME;
  });

  afterEach(() => {
    // Restore original env vars
    if (originalEnvVars.CLEAN_QUEUED_TIME !== undefined) {
      process.env.CLEAN_QUEUED_TIME = originalEnvVars.CLEAN_QUEUED_TIME;
    }
    if (originalEnvVars.CLEAN_FINALIZED_TIME !== undefined) {
      process.env.CLEAN_FINALIZED_TIME = originalEnvVars.CLEAN_FINALIZED_TIME;
    }
    if (originalEnvVars.CLEAN_BRIDGED_TIME !== undefined) {
      process.env.CLEAN_BRIDGED_TIME = originalEnvVars.CLEAN_BRIDGED_TIME;
    }
  });

  describe('cleanQueuedDeposits', () => {
    test('should delete deposits older than default 48 hours and keep newer ones', async () => {
      const { cleanQueuedDeposits } = await import('../../../services/CleanupDeposits.js');

      const currentTime = Date.now();
      const deposits = [
        createTestDeposit({
          id: 'keep-1day',
          dates: {
            ...createTestDeposit().dates,
            createdAt: currentTime - 24 * 60 * 60 * 1000, // 1 day old
          },
        }),
        createTestDeposit({
          id: 'keep-2days',
          dates: {
            ...createTestDeposit().dates,
            createdAt: currentTime - 47.9 * 60 * 60 * 1000, // just under 48 hours
          },
        }),
        createTestDeposit({
          id: 'delete-3days',
          dates: {
            ...createTestDeposit().dates,
            createdAt: currentTime - 72 * 60 * 60 * 1000, // 3 days old
          },
        }),
        createTestDeposit({
          id: 'delete-7days',
          dates: {
            ...createTestDeposit().dates,
            createdAt: currentTime - 168 * 60 * 60 * 1000, // 7 days old
          },
        }),
      ];

      mockDepositStore.getByStatus.mockResolvedValue(deposits);
      mockDepositStore.getById.mockImplementation(
        async (id: string) => deposits.find((d) => d.id === id) || null,
      );

      await cleanQueuedDeposits();

      // Verify correct calls
      expect(mockDepositStore.getByStatus).toHaveBeenCalledWith(DepositStatus.QUEUED);
      expect(mockDepositStore.delete).toHaveBeenCalledTimes(2);
      expect(mockDepositStore.delete).toHaveBeenCalledWith('delete-3days');
      expect(mockDepositStore.delete).toHaveBeenCalledWith('delete-7days');

      // Verify audit logs
      expect(mockLogDepositDeleted).toHaveBeenCalledTimes(2);
      expect(mockLogDepositDeleted).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'delete-3days' }),
        expect.stringContaining('QUEUED deposit exceeded age limit'),
      );
      expect(mockLogDepositDeleted).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'delete-7days' }),
        expect.stringContaining('QUEUED deposit exceeded age limit'),
      );
    });

    test('should handle empty deposit list gracefully', async () => {
      const { cleanQueuedDeposits } = await import('../../../services/CleanupDeposits.js');

      mockDepositStore.getByStatus.mockResolvedValue([]);

      await cleanQueuedDeposits();

      expect(mockDepositStore.getByStatus).toHaveBeenCalledWith(DepositStatus.QUEUED);
      expect(mockDepositStore.delete).not.toHaveBeenCalled();
      expect(mockLogDepositDeleted).not.toHaveBeenCalled();
    });

    test('should skip deposits with missing createdAt', async () => {
      const { cleanQueuedDeposits } = await import('../../../services/CleanupDeposits.js');

      const deposits = [
        createTestDeposit({
          id: 'no-created-at',
          dates: {
            ...createTestDeposit().dates,
            createdAt: null,
          },
        }),
        createTestDeposit({
          id: 'undefined-created-at',
          dates: {
            ...createTestDeposit().dates,
            createdAt: undefined as any,
          },
        }),
      ];

      mockDepositStore.getByStatus.mockResolvedValue(deposits);

      await cleanQueuedDeposits();

      expect(mockDepositStore.delete).not.toHaveBeenCalled();
      expect(mockLogDepositDeleted).not.toHaveBeenCalled();
    });

    test('should respect custom CLEAN_QUEUED_TIME environment variable', async () => {
      // Clean up any cached modules
      jest.resetModules();
      process.env.CLEAN_QUEUED_TIME = '24'; // 24 hours instead of default 48

      const { cleanQueuedDeposits } = await import('../../../services/CleanupDeposits.js');

      const currentTime = Date.now();
      const deposits = [
        createTestDeposit({
          id: 'should-delete',
          dates: {
            ...createTestDeposit().dates,
            createdAt: currentTime - 25 * 60 * 60 * 1000, // 25 hours old
          },
        }),
        createTestDeposit({
          id: 'should-keep',
          dates: {
            ...createTestDeposit().dates,
            createdAt: currentTime - 23 * 60 * 60 * 1000, // 23 hours old
          },
        }),
      ];

      mockDepositStore.getByStatus.mockResolvedValue(deposits);
      mockDepositStore.getById.mockImplementation(
        async (id: string) => deposits.find((d) => d.id === id) || null,
      );

      await cleanQueuedDeposits();

      expect(mockDepositStore.delete).toHaveBeenCalledTimes(1);
      expect(mockDepositStore.delete).toHaveBeenCalledWith('should-delete');
    });
  });

  describe('cleanFinalizedDeposits', () => {
    test('should delete deposits older than default 12 hours based on finalizationAt', async () => {
      const { cleanFinalizedDeposits } = await import('../../../services/CleanupDeposits.js');

      const currentTime = Date.now();
      const deposits = [
        createTestDeposit({
          id: 'keep-6h',
          status: DepositStatus.FINALIZED,
          dates: {
            ...createTestDeposit().dates,
            finalizationAt: currentTime - 6 * 60 * 60 * 1000, // 6 hours ago
          },
        }),
        createTestDeposit({
          id: 'keep-11h',
          status: DepositStatus.FINALIZED,
          dates: {
            ...createTestDeposit().dates,
            finalizationAt: currentTime - 11 * 60 * 60 * 1000, // 11 hours ago
          },
        }),
        createTestDeposit({
          id: 'delete-13h',
          status: DepositStatus.FINALIZED,
          dates: {
            ...createTestDeposit().dates,
            finalizationAt: currentTime - 13 * 60 * 60 * 1000, // 13 hours ago
          },
        }),
      ];

      mockDepositStore.getByStatus.mockResolvedValue(deposits);
      mockDepositStore.getById.mockImplementation(
        async (id: string) => deposits.find((d) => d.id === id) || null,
      );

      await cleanFinalizedDeposits();

      expect(mockDepositStore.getByStatus).toHaveBeenCalledWith(DepositStatus.FINALIZED);
      expect(mockDepositStore.delete).toHaveBeenCalledTimes(1);
      expect(mockDepositStore.delete).toHaveBeenCalledWith('delete-13h');
    });

    test('should skip deposits with missing finalizationAt', async () => {
      const { cleanFinalizedDeposits } = await import('../../../services/CleanupDeposits.js');

      const deposits = [
        createTestDeposit({
          id: 'no-finalization-at',
          status: DepositStatus.FINALIZED,
          dates: {
            ...createTestDeposit().dates,
            finalizationAt: null,
          },
        }),
      ];

      mockDepositStore.getByStatus.mockResolvedValue(deposits);

      await cleanFinalizedDeposits();

      expect(mockDepositStore.delete).not.toHaveBeenCalled();
      expect(mockLogDepositDeleted).not.toHaveBeenCalled();
    });

    test('should respect custom CLEAN_FINALIZED_TIME environment variable', async () => {
      jest.resetModules();
      process.env.CLEAN_FINALIZED_TIME = '6'; // 6 hours instead of default 12

      const { cleanFinalizedDeposits } = await import('../../../services/CleanupDeposits.js');

      const currentTime = Date.now();
      const deposit = createTestDeposit({
        id: 'should-delete-7h',
        status: DepositStatus.FINALIZED,
        dates: {
          ...createTestDeposit().dates,
          finalizationAt: currentTime - 7 * 60 * 60 * 1000, // 7 hours ago
        },
      });

      mockDepositStore.getByStatus.mockResolvedValue([deposit]);
      mockDepositStore.getById.mockResolvedValue(deposit);

      await cleanFinalizedDeposits();

      expect(mockDepositStore.delete).toHaveBeenCalledWith('should-delete-7h');
    });
  });

  describe('cleanBridgedDeposits', () => {
    test('should delete deposits older than default 12 hours based on bridgedAt', async () => {
      const { cleanBridgedDeposits } = await import('../../../services/CleanupDeposits.js');

      const currentTime = Date.now();
      const deposits = [
        createTestDeposit({
          id: 'keep-10h',
          status: DepositStatus.BRIDGED,
          dates: {
            ...createTestDeposit().dates,
            bridgedAt: currentTime - 10 * 60 * 60 * 1000, // 10 hours ago
          },
        }),
        createTestDeposit({
          id: 'delete-15h',
          status: DepositStatus.BRIDGED,
          dates: {
            ...createTestDeposit().dates,
            bridgedAt: currentTime - 15 * 60 * 60 * 1000, // 15 hours ago
          },
        }),
      ];

      mockDepositStore.getByStatus.mockResolvedValue(deposits);
      mockDepositStore.getById.mockImplementation(
        async (id: string) => deposits.find((d) => d.id === id) || null,
      );

      await cleanBridgedDeposits();

      expect(mockDepositStore.getByStatus).toHaveBeenCalledWith(DepositStatus.BRIDGED);
      expect(mockDepositStore.delete).toHaveBeenCalledTimes(1);
      expect(mockDepositStore.delete).toHaveBeenCalledWith('delete-15h');
    });

    test('should skip deposits with missing bridgedAt', async () => {
      const { cleanBridgedDeposits } = await import('../../../services/CleanupDeposits.js');

      const deposits = [
        createTestDeposit({
          id: 'no-bridged-at',
          status: DepositStatus.BRIDGED,
          dates: {
            ...createTestDeposit().dates,
            bridgedAt: null,
          },
        }),
      ];

      mockDepositStore.getByStatus.mockResolvedValue(deposits);

      await cleanBridgedDeposits();

      expect(mockDepositStore.delete).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    test('should handle DepositStore.getById returning null during audit logging', async () => {
      const { cleanQueuedDeposits } = await import('../../../services/CleanupDeposits.js');

      const currentTime = Date.now();
      const deposit = createTestDeposit({
        id: 'test-deposit',
        dates: {
          ...createTestDeposit().dates,
          createdAt: currentTime - 72 * 60 * 60 * 1000, // 3 days old
        },
      });

      mockDepositStore.getByStatus.mockResolvedValue([deposit]);
      mockDepositStore.getById.mockResolvedValue(null); // Simulate deposit not found

      await cleanQueuedDeposits();

      // Should still delete the deposit even if audit logging fails to find it
      expect(mockDepositStore.delete).toHaveBeenCalledWith('test-deposit');
      expect(mockLogDepositDeleted).not.toHaveBeenCalled(); // Since getById returned null
    });

    test('should continue processing other deposits if one fails during deletion', async () => {
      const { cleanQueuedDeposits } = await import('../../../services/CleanupDeposits.js');

      const currentTime = Date.now();
      const deposits = [
        createTestDeposit({
          id: 'will-fail',
          dates: {
            ...createTestDeposit().dates,
            createdAt: currentTime - 72 * 60 * 60 * 1000,
          },
        }),
        createTestDeposit({
          id: 'will-succeed',
          dates: {
            ...createTestDeposit().dates,
            createdAt: currentTime - 72 * 60 * 60 * 1000,
          },
        }),
      ];

      mockDepositStore.getByStatus.mockResolvedValue(deposits);
      mockDepositStore.getById.mockImplementation(
        async (id: string) => deposits.find((d) => d.id === id) || null,
      );

      // Make the first delete call fail, second succeed
      mockDepositStore.delete
        .mockRejectedValueOnce(new Error('Delete failed'))
        .mockResolvedValueOnce(undefined);

      // With our error handling, this should NOT throw and should continue processing
      await expect(cleanQueuedDeposits()).resolves.not.toThrow();

      // Verify both delete calls were attempted
      expect(mockDepositStore.delete).toHaveBeenCalledWith('will-fail');
      expect(mockDepositStore.delete).toHaveBeenCalledWith('will-succeed');
      expect(mockDepositStore.delete).toHaveBeenCalledTimes(2);
    });

    test('should handle top-level errors and re-throw them', async () => {
      const { cleanQueuedDeposits } = await import('../../../services/CleanupDeposits.js');

      // Simulate getByStatus throwing an error
      mockDepositStore.getByStatus.mockRejectedValue(new Error('Database connection failed'));

      // Top-level errors should still be thrown
      await expect(cleanQueuedDeposits()).rejects.toThrow('Database connection failed');
    });
  });
});
