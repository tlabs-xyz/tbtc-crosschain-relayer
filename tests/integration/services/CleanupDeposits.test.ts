import { jest } from '@jest/globals';
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import type { Deposit } from '../../../types/Deposit.type.js';
import { DepositStatus } from '../../../types/DepositStatus.enum.js';

// Mock logger first
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

// Mock AuditLog
jest.mock('../../../utils/AuditLog', () => ({
  __esModule: true,
  logDepositDeleted: jest.fn(),
}));

// Mock DepositStore
jest.mock('../../../utils/DepositStore', () => ({
  __esModule: true,
  DepositStore: {
    getByStatus: jest.fn(),
    getById: jest.fn(),
    delete: jest.fn(),
  },
}));

import logger from '../../../utils/Logger.js';
import { logDepositDeleted } from '../../../utils/AuditLog.js';
import { DepositStore } from '../../../utils/DepositStore.js';
import {
  cleanQueuedDeposits,
  cleanFinalizedDeposits,
  cleanBridgedDeposits,
} from '../../../services/CleanupDeposits.js';

const mockLogger = logger as jest.Mocked<typeof logger>;
const mockLogDepositDeleted = logDepositDeleted as jest.MockedFunction<typeof logDepositDeleted>;
const mockDepositStore = DepositStore as jest.Mocked<typeof DepositStore>;

// Helper to create mock deposits
const createMockDeposit = (
  id: string,
  status: DepositStatus,
  dates: Partial<Deposit['dates']> = {},
): Deposit => ({
  id,
  chainName: 'ethereum',
  fundingTxHash: 'mock-funding-tx',
  outputIndex: 0,
  hashes: {
    btc: { btcTxHash: 'mock-btc-tx' },
    eth: { initializeTxHash: null, finalizeTxHash: null },
    solana: { bridgeTxHash: null },
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
  status,
  L1OutputEvent: {
    fundingTx: {
      transactionHash: 'mock-funding-tx',
      outputIndex: 0,
      value: 1000000,
    } as any,
    reveal: {} as any,
    l2DepositOwner: 'mock-l2-owner',
    l2Sender: 'mock-l2-sender',
  },
  dates: {
    createdAt: Date.now(),
    initializationAt: null,
    finalizationAt: null,
    awaitingWormholeVAAMessageSince: null,
    bridgedAt: null,
    lastActivityAt: Date.now(),
    ...dates,
  },
  wormholeInfo: {
    txHash: null,
    transferSequence: null,
    bridgingAttempted: false,
  },
  error: null,
});

describe('CleanupDeposits Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset environment variables to defaults
    delete process.env.CLEAN_QUEUED_TIME;
    delete process.env.CLEAN_FINALIZED_TIME;
    delete process.env.CLEAN_BRIDGED_TIME;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('cleanQueuedDeposits', () => {
    test('should delete QUEUED deposits older than configured time (default 48 hours)', async () => {
      const now = Date.now();
      const oldDeposit = createMockDeposit('old-queued', DepositStatus.QUEUED, {
        createdAt: now - 52 * 60 * 60 * 1000, // 52 hours ago - safely over threshold
      });
      const recentDeposit = createMockDeposit('recent-queued', DepositStatus.QUEUED, {
        createdAt: now - 40 * 60 * 60 * 1000, // 40 hours ago - very safely under threshold
      });

      mockDepositStore.getByStatus.mockResolvedValue([oldDeposit, recentDeposit]);
      // getById is only called for old deposits that will be deleted
      mockDepositStore.getById.mockResolvedValue(oldDeposit);

      await cleanQueuedDeposits();

      expect(mockDepositStore.getByStatus).toHaveBeenCalledWith(DepositStatus.QUEUED);
      expect(mockDepositStore.getById).toHaveBeenCalledWith('old-queued');
      expect(mockDepositStore.getById).toHaveBeenCalledTimes(1); // Only called for old deposit
      expect(mockLogDepositDeleted).toHaveBeenCalledWith(
        oldDeposit,
        expect.stringContaining('QUEUED deposit exceeded age limit'),
      );
      expect(mockLogDepositDeleted).toHaveBeenCalledTimes(1); // Only old deposit is deleted
      expect(mockDepositStore.delete).toHaveBeenCalledWith('old-queued');
      expect(mockDepositStore.delete).toHaveBeenCalledTimes(1); // Only called once
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Deleted QUEUED deposit old-queued'),
      );
    });

    test('should respect custom CLEAN_QUEUED_TIME environment variable', async () => {
      process.env.CLEAN_QUEUED_TIME = '24'; // 24 hours instead of default 48

      // Need to re-import after setting env var for it to take effect
      jest.resetModules();

      // Re-setup mocks after resetModules
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
      jest.mock('../../../utils/AuditLog', () => ({
        __esModule: true,
        logDepositDeleted: jest.fn(),
      }));
      jest.mock('../../../utils/DepositStore', () => ({
        __esModule: true,
        DepositStore: {
          getByStatus: jest.fn(),
          getById: jest.fn(),
          delete: jest.fn(),
        },
      }));

      const { cleanQueuedDeposits: cleanQueuedDepositsWithCustomTime } = await import(
        '../../../services/CleanupDeposits.js'
      );
      const { DepositStore: mockDepositStoreCustom } = await import(
        '../../../utils/DepositStore.js'
      );
      const { logDepositDeleted: _mockLogDepositDeletedCustom } = await import(
        '../../../utils/AuditLog.js'
      );

      const mockDepositStoreTyped = mockDepositStoreCustom as jest.Mocked<typeof DepositStore>;

      const now = Date.now();
      const oldDeposit = createMockDeposit('old-queued', DepositStatus.QUEUED, {
        createdAt: now - 26 * 60 * 60 * 1000, // 26 hours ago - safely over 24 hour threshold
      });

      mockDepositStoreTyped.getByStatus.mockResolvedValue([oldDeposit]);
      mockDepositStoreTyped.getById.mockResolvedValue(oldDeposit);

      await cleanQueuedDepositsWithCustomTime();

      expect(mockDepositStoreTyped.delete).toHaveBeenCalledWith('old-queued');
    });

    test('should handle deposits without createdAt date gracefully', async () => {
      const depositWithoutDate = createMockDeposit('no-date', DepositStatus.QUEUED, {
        createdAt: null,
      });

      mockDepositStore.getByStatus.mockResolvedValue([depositWithoutDate]);

      await cleanQueuedDeposits();

      expect(mockDepositStore.getByStatus).toHaveBeenCalledWith(DepositStatus.QUEUED);
      expect(mockDepositStore.delete).not.toHaveBeenCalled();
      expect(mockLogDepositDeleted).not.toHaveBeenCalled();
    });

    test('should handle empty deposits list', async () => {
      mockDepositStore.getByStatus.mockResolvedValue([]);

      await cleanQueuedDeposits();

      expect(mockDepositStore.getByStatus).toHaveBeenCalledWith(DepositStatus.QUEUED);
      expect(mockDepositStore.delete).not.toHaveBeenCalled();
      expect(mockLogDepositDeleted).not.toHaveBeenCalled();
    });

    test('should handle DepositStore.getById returning null', async () => {
      const now = Date.now();
      const oldDeposit = createMockDeposit('old-queued', DepositStatus.QUEUED, {
        createdAt: now - 50 * 60 * 60 * 1000, // 50 hours ago - safely over threshold
      });

      mockDepositStore.getByStatus.mockResolvedValue([oldDeposit]);
      mockDepositStore.getById.mockResolvedValue(null); // Deposit not found

      await cleanQueuedDeposits();

      expect(mockDepositStore.getById).toHaveBeenCalledWith('old-queued');
      expect(mockLogDepositDeleted).not.toHaveBeenCalled();
      expect(mockDepositStore.delete).toHaveBeenCalledWith('old-queued');
    });

    test('should continue processing other deposits if one fails', async () => {
      const now = Date.now();
      const deposit1 = createMockDeposit('old-queued-1', DepositStatus.QUEUED, {
        createdAt: now - 50 * 60 * 60 * 1000, // 50 hours ago - safely over threshold
      });
      const deposit2 = createMockDeposit('old-queued-2', DepositStatus.QUEUED, {
        createdAt: now - 51 * 60 * 60 * 1000, // 51 hours ago - safely over threshold
      });

      mockDepositStore.getByStatus.mockResolvedValue([deposit1, deposit2]);
      mockDepositStore.getById.mockResolvedValueOnce(deposit1).mockResolvedValueOnce(deposit2);

      // Mock delete to reject first, succeed second
      let _callCount = 0;
      mockDepositStore.delete.mockImplementation(() => {
        _callCount++;
        if (_callCount === 1) {
          return Promise.reject(new Error('Delete failed'));
        }
        return Promise.resolve();
      });

      // The function should not throw but continue processing
      await expect(cleanQueuedDeposits()).resolves.not.toThrow();

      expect(mockDepositStore.delete).toHaveBeenCalledWith('old-queued-1');
      expect(mockDepositStore.delete).toHaveBeenCalledWith('old-queued-2');
      expect(mockLogDepositDeleted).toHaveBeenCalledTimes(2);
    });

    test('should throw error if initial getByStatus fails', async () => {
      mockDepositStore.getByStatus.mockRejectedValue(new Error('Database error'));

      await expect(cleanQueuedDeposits()).rejects.toThrow('Database error');
    });
  });

  describe('cleanFinalizedDeposits', () => {
    test('should delete FINALIZED deposits older than configured time (default 12 hours)', async () => {
      const now = Date.now();
      const oldDeposit = createMockDeposit('old-finalized', DepositStatus.FINALIZED, {
        finalizationAt: now - 16 * 60 * 60 * 1000, // 16 hours ago - safely over threshold
      });
      const recentDeposit = createMockDeposit('recent-finalized', DepositStatus.FINALIZED, {
        finalizationAt: now - 8 * 60 * 60 * 1000, // 8 hours ago - very safely under threshold
      });

      mockDepositStore.getByStatus.mockResolvedValue([oldDeposit, recentDeposit]);
      // getById is only called for old deposits that will be deleted
      mockDepositStore.getById.mockResolvedValue(oldDeposit);

      await cleanFinalizedDeposits();

      expect(mockDepositStore.getByStatus).toHaveBeenCalledWith(DepositStatus.FINALIZED);
      expect(mockDepositStore.getById).toHaveBeenCalledWith('old-finalized');
      expect(mockDepositStore.getById).toHaveBeenCalledTimes(1); // Only called for old deposit
      expect(mockLogDepositDeleted).toHaveBeenCalledWith(
        oldDeposit,
        expect.stringContaining('FINALIZED deposit exceeded age limit'),
      );
      expect(mockLogDepositDeleted).toHaveBeenCalledTimes(1); // Only old deposit is deleted
      expect(mockDepositStore.delete).toHaveBeenCalledWith('old-finalized');
      expect(mockDepositStore.delete).toHaveBeenCalledTimes(1); // Only old deposit deleted
    });

    test('should handle deposits without finalizationAt date gracefully', async () => {
      const depositWithoutDate = createMockDeposit(
        'no-finalization-date',
        DepositStatus.FINALIZED,
        {
          finalizationAt: null,
        },
      );

      mockDepositStore.getByStatus.mockResolvedValue([depositWithoutDate]);

      await cleanFinalizedDeposits();

      expect(mockDepositStore.getByStatus).toHaveBeenCalledWith(DepositStatus.FINALIZED);
      expect(mockDepositStore.delete).not.toHaveBeenCalled();
      expect(mockLogDepositDeleted).not.toHaveBeenCalled();
    });

    test('should respect custom CLEAN_FINALIZED_TIME environment variable', async () => {
      process.env.CLEAN_FINALIZED_TIME = '6'; // 6 hours instead of default 12

      jest.resetModules();

      // Re-setup mocks
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
      jest.mock('../../../utils/AuditLog', () => ({
        __esModule: true,
        logDepositDeleted: jest.fn(),
      }));
      jest.mock('../../../utils/DepositStore', () => ({
        __esModule: true,
        DepositStore: {
          getByStatus: jest.fn(),
          getById: jest.fn(),
          delete: jest.fn(),
        },
      }));

      const { cleanFinalizedDeposits: cleanFinalizedDepositsWithCustomTime } = await import(
        '../../../services/CleanupDeposits.js'
      );
      const { DepositStore: mockDepositStoreCustom } = await import(
        '../../../utils/DepositStore.js'
      );

      const mockDepositStoreTyped = mockDepositStoreCustom as jest.Mocked<typeof DepositStore>;

      const now = Date.now();
      const oldDeposit = createMockDeposit('old-finalized', DepositStatus.FINALIZED, {
        finalizationAt: now - 7 * 60 * 60 * 1000, // 7 hours ago
      });

      mockDepositStoreTyped.getByStatus.mockResolvedValue([oldDeposit]);
      mockDepositStoreTyped.getById.mockResolvedValue(oldDeposit);

      await cleanFinalizedDepositsWithCustomTime();

      expect(mockDepositStoreTyped.delete).toHaveBeenCalledWith('old-finalized');
    });
  });

  describe('cleanBridgedDeposits', () => {
    test('should delete BRIDGED deposits older than configured time (default 12 hours)', async () => {
      const now = Date.now();
      const oldDeposit = createMockDeposit('old-bridged', DepositStatus.BRIDGED, {
        bridgedAt: now - 13 * 60 * 60 * 1000, // 13 hours ago
      });
      const recentDeposit = createMockDeposit('recent-bridged', DepositStatus.BRIDGED, {
        bridgedAt: now - 11 * 60 * 60 * 1000, // 11 hours ago
      });

      mockDepositStore.getByStatus.mockResolvedValue([oldDeposit, recentDeposit]);
      // Only the old deposit should trigger getById since only it meets age criteria
      mockDepositStore.getById.mockResolvedValueOnce(oldDeposit);

      await cleanBridgedDeposits();

      expect(mockDepositStore.getByStatus).toHaveBeenCalledWith(DepositStatus.BRIDGED);
      expect(mockDepositStore.getById).toHaveBeenCalledWith('old-bridged');
      expect(mockDepositStore.getById).toHaveBeenCalledTimes(1); // Only called for old deposit
      expect(mockLogDepositDeleted).toHaveBeenCalledWith(
        oldDeposit,
        expect.stringContaining('BRIDGED deposit exceeded age limit'),
      );
      expect(mockLogDepositDeleted).toHaveBeenCalledTimes(1);
      expect(mockDepositStore.delete).toHaveBeenCalledWith('old-bridged');
      expect(mockDepositStore.delete).toHaveBeenCalledTimes(1);
    });

    test('should handle deposits without bridgedAt date gracefully', async () => {
      const depositWithoutDate = createMockDeposit('no-bridged-date', DepositStatus.BRIDGED, {
        bridgedAt: null,
      });

      mockDepositStore.getByStatus.mockResolvedValue([depositWithoutDate]);

      await cleanBridgedDeposits();

      expect(mockDepositStore.getByStatus).toHaveBeenCalledWith(DepositStatus.BRIDGED);
      expect(mockDepositStore.delete).not.toHaveBeenCalled();
      expect(mockLogDepositDeleted).not.toHaveBeenCalled();
    });

    test('should respect custom CLEAN_BRIDGED_TIME environment variable', async () => {
      process.env.CLEAN_BRIDGED_TIME = '6'; // 6 hours instead of default 12

      jest.resetModules();

      // Re-setup mocks
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
      jest.mock('../../../utils/AuditLog', () => ({
        __esModule: true,
        logDepositDeleted: jest.fn(),
      }));
      jest.mock('../../../utils/DepositStore', () => ({
        __esModule: true,
        DepositStore: {
          getByStatus: jest.fn(),
          getById: jest.fn(),
          delete: jest.fn(),
        },
      }));

      const { cleanBridgedDeposits: cleanBridgedDepositsWithCustomTime } = await import(
        '../../../services/CleanupDeposits.js'
      );
      const { DepositStore: mockDepositStoreCustom } = await import(
        '../../../utils/DepositStore.js'
      );

      const mockDepositStoreTyped = mockDepositStoreCustom as jest.Mocked<typeof DepositStore>;

      const now = Date.now();
      const oldDeposit = createMockDeposit('old-bridged', DepositStatus.BRIDGED, {
        bridgedAt: now - 7 * 60 * 60 * 1000, // 7 hours ago
      });

      mockDepositStoreTyped.getByStatus.mockResolvedValue([oldDeposit]);
      mockDepositStoreTyped.getById.mockResolvedValue(oldDeposit);

      await cleanBridgedDepositsWithCustomTime();

      expect(mockDepositStoreTyped.delete).toHaveBeenCalledWith('old-bridged');
    });

    test('should use correct log level (info) for bridged deposits', async () => {
      const now = Date.now();
      const oldDeposit = createMockDeposit('old-bridged', DepositStatus.BRIDGED, {
        bridgedAt: now - 13 * 60 * 60 * 1000,
      });

      mockDepositStore.getByStatus.mockResolvedValue([oldDeposit]);
      mockDepositStore.getById.mockResolvedValue(oldDeposit);

      await cleanBridgedDeposits();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Deleted BRIDGED deposit old-bridged'),
      );
    });
  });

  describe('Error Handling', () => {
    test('should handle DepositStore.getByStatus errors', async () => {
      const error = new Error('Database connection failed');
      mockDepositStore.getByStatus.mockRejectedValue(error);

      await expect(cleanQueuedDeposits()).rejects.toThrow('Database connection failed');
    });

    test('should handle DepositStore.delete errors but continue processing', async () => {
      const now = Date.now();
      const deposit1 = createMockDeposit('deposit-1', DepositStatus.QUEUED, {
        createdAt: now - 49 * 60 * 60 * 1000,
      });
      const deposit2 = createMockDeposit('deposit-2', DepositStatus.QUEUED, {
        createdAt: now - 50 * 60 * 60 * 1000,
      });

      mockDepositStore.getByStatus.mockResolvedValue([deposit1, deposit2]);
      mockDepositStore.getById.mockResolvedValueOnce(deposit1).mockResolvedValueOnce(deposit2);

      // Mock delete to fail for first, succeed for second
      let _callCount = 0;
      mockDepositStore.delete.mockImplementation(() => {
        _callCount++;
        if (_callCount === 1) {
          return Promise.reject(new Error('Delete operation failed'));
        }
        return Promise.resolve();
      });

      // Should not throw, but continue processing
      await expect(cleanQueuedDeposits()).resolves.not.toThrow();

      expect(mockDepositStore.delete).toHaveBeenCalledWith('deposit-1');
      expect(mockDepositStore.delete).toHaveBeenCalledWith('deposit-2');
      expect(mockLogDepositDeleted).toHaveBeenCalledTimes(2);
    });

    test('should handle AuditLog.logDepositDeleted errors gracefully', async () => {
      const now = Date.now();
      const oldDeposit = createMockDeposit('old-queued', DepositStatus.QUEUED, {
        createdAt: now - 49 * 60 * 60 * 1000,
      });

      mockDepositStore.getByStatus.mockResolvedValue([oldDeposit]);
      mockDepositStore.getById.mockResolvedValue(oldDeposit);

      // Mock audit log to fail
      let _callCount = 0;
      mockLogDepositDeleted.mockImplementation(() => {
        _callCount++;
        return Promise.reject(new Error('Audit log failed'));
      });

      // Should still proceed with deletion even if audit log fails
      await expect(cleanQueuedDeposits()).resolves.not.toThrow();

      expect(mockLogDepositDeleted).toHaveBeenCalled();
      expect(mockDepositStore.delete).toHaveBeenCalledWith('old-queued');
    });
  });
});
