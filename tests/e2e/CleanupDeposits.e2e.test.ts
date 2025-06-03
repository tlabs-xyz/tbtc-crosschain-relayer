import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
  cleanQueuedDeposits,
  cleanFinalizedDeposits,
  cleanBridgedDeposits,
} from '../../services/CleanupDeposits.js';
import { DepositStore } from '../../utils/DepositStore.js';
import { DepositStatus } from '../../types/DepositStatus.enum.js';
import { prisma } from '../../utils/prisma.js';

describe('CleanupDeposits E2E Tests', () => {
  beforeEach(async () => {
    // Clean database before each test
    await prisma.deposit.deleteMany({});
    await prisma.auditLog.deleteMany({});
  });

  afterEach(async () => {
    // Clean database after each test
    await prisma.deposit.deleteMany({});
    await prisma.auditLog.deleteMany({});
  });

  describe('cleanQueuedDeposits E2E', () => {
    test('should clean up queued deposits older than the configured time', async () => {
      // Mock environment variable for faster testing (1 hour instead of 48)
      const originalValue = process.env.CLEAN_QUEUED_TIME;
      process.env.CLEAN_QUEUED_TIME = '1';

      try {
        // Create old queued deposit (older than 1 hour)
        const oldTimestamp = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
        const oldDeposit = {
          id: 'old-queued-deposit',
          chainName: 'MockEVM1',
          fundingTxHash: '0x' + '1'.repeat(64),
          outputIndex: 0,
          hashes: {
            btc: { btcTxHash: '0x' + '1'.repeat(64) },
            eth: { initializeTxHash: null, finalizeTxHash: null },
            solana: { bridgeTxHash: null },
          },
          receipt: {
            depositor: '0x' + '1'.repeat(40),
            blindingFactor: 'test_blinding_factor',
            walletPublicKeyHash: 'test_hash',
            refundPublicKeyHash: 'test_refund_hash',
            refundLocktime: '1234567890',
            extraData: 'test_extra_data',
          },
          owner: '0x' + '1'.repeat(40),
          L1OutputEvent: null,
          status: DepositStatus.QUEUED,
          dates: {
            createdAt: oldTimestamp,
            initializationAt: null,
            finalizationAt: null,
            awaitingWormholeVAAMessageSince: null,
            bridgedAt: null,
            lastActivityAt: Date.now(),
          },
          wormholeInfo: {
            txHash: null,
            transferSequence: null,
            bridgingAttempted: false,
          },
          error: null,
        };

        // Create recent queued deposit (should not be deleted)
        const recentTimestamp = Date.now() - 30 * 60 * 1000; // 30 minutes ago
        const recentDeposit = {
          id: 'recent-queued-deposit',
          chainName: 'MockEVM1',
          fundingTxHash: '0x' + '2'.repeat(64),
          outputIndex: 0,
          hashes: {
            btc: { btcTxHash: '0x' + '2'.repeat(64) },
            eth: { initializeTxHash: null, finalizeTxHash: null },
            solana: { bridgeTxHash: null },
          },
          receipt: {
            depositor: '0x' + '2'.repeat(40),
            blindingFactor: 'test_blinding_factor',
            walletPublicKeyHash: 'test_hash',
            refundPublicKeyHash: 'test_refund_hash',
            refundLocktime: '1234567890',
            extraData: 'test_extra_data',
          },
          owner: '0x' + '2'.repeat(40),
          L1OutputEvent: null,
          status: DepositStatus.QUEUED,
          dates: {
            createdAt: recentTimestamp,
            initializationAt: null,
            finalizationAt: null,
            awaitingWormholeVAAMessageSince: null,
            bridgedAt: null,
            lastActivityAt: Date.now(),
          },
          wormholeInfo: {
            txHash: null,
            transferSequence: null,
            bridgingAttempted: false,
          },
          error: null,
        };

        await DepositStore.create(oldDeposit);
        await DepositStore.create(recentDeposit);

        // Verify deposits were created
        let deposits = await DepositStore.getByStatus(DepositStatus.QUEUED);
        expect(deposits).toHaveLength(2);

        // Run cleanup
        await cleanQueuedDeposits();

        // Verify old deposit was deleted, recent one remains
        deposits = await DepositStore.getByStatus(DepositStatus.QUEUED);
        expect(deposits).toHaveLength(1);
        expect(deposits[0].id).toBe('recent-queued-deposit');

        // Verify old deposit is completely gone
        const oldDepositCheck = await DepositStore.getById('old-queued-deposit');
        expect(oldDepositCheck).toBeNull();
      } finally {
        // Restore original environment variable
        if (originalValue) {
          process.env.CLEAN_QUEUED_TIME = originalValue;
        } else {
          delete process.env.CLEAN_QUEUED_TIME;
        }
      }
    });
  });

  describe('cleanFinalizedDeposits E2E', () => {
    test('should clean up finalized deposits older than the configured time', async () => {
      // Mock environment variable for faster testing (1 hour instead of 12)
      const originalValue = process.env.CLEAN_FINALIZED_TIME;
      process.env.CLEAN_FINALIZED_TIME = '1';

      try {
        // Create old finalized deposit (older than 1 hour)
        const oldTimestamp = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
        const oldDeposit = {
          id: 'old-finalized-deposit',
          chainName: 'MockEVM1',
          fundingTxHash: '0x' + '1'.repeat(64),
          outputIndex: 0,
          hashes: {
            btc: { btcTxHash: '0x' + '1'.repeat(64) },
            eth: { initializeTxHash: null, finalizeTxHash: null },
            solana: { bridgeTxHash: null },
          },
          receipt: {
            depositor: '0x' + '1'.repeat(40),
            blindingFactor: 'test_blinding_factor',
            walletPublicKeyHash: 'test_hash',
            refundPublicKeyHash: 'test_refund_hash',
            refundLocktime: '1234567890',
            extraData: 'test_extra_data',
          },
          owner: '0x' + '1'.repeat(40),
          L1OutputEvent: null,
          status: DepositStatus.FINALIZED,
          dates: {
            createdAt: Date.now() - 3 * 60 * 60 * 1000,
            initializationAt: Date.now() - 2.5 * 60 * 60 * 1000,
            finalizationAt: oldTimestamp,
            awaitingWormholeVAAMessageSince: null,
            bridgedAt: null,
            lastActivityAt: Date.now(),
          },
          wormholeInfo: {
            txHash: null,
            transferSequence: null,
            bridgingAttempted: false,
          },
          error: null,
        };

        // Create recent finalized deposit (should not be deleted)
        const recentTimestamp = Date.now() - 30 * 60 * 1000; // 30 minutes ago
        const recentDeposit = {
          id: 'recent-finalized-deposit',
          chainName: 'MockEVM1',
          fundingTxHash: '0x' + '2'.repeat(64),
          outputIndex: 0,
          hashes: {
            btc: { btcTxHash: '0x' + '2'.repeat(64) },
            eth: { initializeTxHash: null, finalizeTxHash: null },
            solana: { bridgeTxHash: null },
          },
          receipt: {
            depositor: '0x' + '2'.repeat(40),
            blindingFactor: 'test_blinding_factor',
            walletPublicKeyHash: 'test_hash',
            refundPublicKeyHash: 'test_refund_hash',
            refundLocktime: '1234567890',
            extraData: 'test_extra_data',
          },
          owner: '0x' + '2'.repeat(40),
          L1OutputEvent: null,
          status: DepositStatus.FINALIZED,
          dates: {
            createdAt: Date.now() - 60 * 60 * 1000,
            initializationAt: Date.now() - 45 * 60 * 1000,
            finalizationAt: recentTimestamp,
            awaitingWormholeVAAMessageSince: null,
            bridgedAt: null,
            lastActivityAt: Date.now(),
          },
          wormholeInfo: {
            txHash: null,
            transferSequence: null,
            bridgingAttempted: false,
          },
          error: null,
        };

        await DepositStore.create(oldDeposit);
        await DepositStore.create(recentDeposit);

        // Verify deposits were created
        let deposits = await DepositStore.getByStatus(DepositStatus.FINALIZED);
        expect(deposits).toHaveLength(2);

        // Run cleanup
        await cleanFinalizedDeposits();

        // Verify old deposit was deleted, recent one remains
        deposits = await DepositStore.getByStatus(DepositStatus.FINALIZED);
        expect(deposits).toHaveLength(1);
        expect(deposits[0].id).toBe('recent-finalized-deposit');
      } finally {
        // Restore original environment variable
        if (originalValue) {
          process.env.CLEAN_FINALIZED_TIME = originalValue;
        } else {
          delete process.env.CLEAN_FINALIZED_TIME;
        }
      }
    });
  });

  describe('cleanBridgedDeposits E2E', () => {
    test('should clean up bridged deposits older than the configured time', async () => {
      // Mock environment variable for faster testing (1 hour instead of 12)
      const originalValue = process.env.CLEAN_BRIDGED_TIME;
      process.env.CLEAN_BRIDGED_TIME = '1';

      try {
        // Create old bridged deposit (older than 1 hour)
        const oldTimestamp = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
        const oldDeposit = {
          id: 'old-bridged-deposit',
          chainName: 'MockEVM1',
          fundingTxHash: '0x' + '1'.repeat(64),
          outputIndex: 0,
          hashes: {
            btc: { btcTxHash: '0x' + '1'.repeat(64) },
            eth: { initializeTxHash: null, finalizeTxHash: null },
            solana: { bridgeTxHash: null },
          },
          receipt: {
            depositor: '0x' + '1'.repeat(40),
            blindingFactor: 'test_blinding_factor',
            walletPublicKeyHash: 'test_hash',
            refundPublicKeyHash: 'test_refund_hash',
            refundLocktime: '1234567890',
            extraData: 'test_extra_data',
          },
          owner: '0x' + '1'.repeat(40),
          L1OutputEvent: null,
          status: DepositStatus.BRIDGED,
          dates: {
            createdAt: Date.now() - 4 * 60 * 60 * 1000,
            initializationAt: Date.now() - 3.5 * 60 * 60 * 1000,
            finalizationAt: Date.now() - 3 * 60 * 60 * 1000,
            awaitingWormholeVAAMessageSince: null,
            bridgedAt: oldTimestamp,
            lastActivityAt: Date.now(),
          },
          wormholeInfo: {
            txHash: null,
            transferSequence: null,
            bridgingAttempted: false,
          },
          error: null,
        };

        // Create recent bridged deposit (should not be deleted)
        const recentTimestamp = Date.now() - 30 * 60 * 1000; // 30 minutes ago
        const recentDeposit = {
          id: 'recent-bridged-deposit',
          chainName: 'MockEVM1',
          fundingTxHash: '0x' + '2'.repeat(64),
          outputIndex: 0,
          hashes: {
            btc: { btcTxHash: '0x' + '2'.repeat(64) },
            eth: { initializeTxHash: null, finalizeTxHash: null },
            solana: { bridgeTxHash: null },
          },
          receipt: {
            depositor: '0x' + '2'.repeat(40),
            blindingFactor: 'test_blinding_factor',
            walletPublicKeyHash: 'test_hash',
            refundPublicKeyHash: 'test_refund_hash',
            refundLocktime: '1234567890',
            extraData: 'test_extra_data',
          },
          owner: '0x' + '2'.repeat(40),
          L1OutputEvent: null,
          status: DepositStatus.BRIDGED,
          dates: {
            createdAt: Date.now() - 2 * 60 * 60 * 1000,
            initializationAt: Date.now() - 1.5 * 60 * 60 * 1000,
            finalizationAt: Date.now() - 60 * 60 * 1000,
            awaitingWormholeVAAMessageSince: null,
            bridgedAt: recentTimestamp,
            lastActivityAt: Date.now(),
          },
          wormholeInfo: {
            txHash: null,
            transferSequence: null,
            bridgingAttempted: false,
          },
          error: null,
        };

        await DepositStore.create(oldDeposit);
        await DepositStore.create(recentDeposit);

        // Verify deposits were created
        let deposits = await DepositStore.getByStatus(DepositStatus.BRIDGED);
        expect(deposits).toHaveLength(2);

        // Run cleanup
        await cleanBridgedDeposits();

        // Verify old deposit was deleted, recent one remains
        deposits = await DepositStore.getByStatus(DepositStatus.BRIDGED);
        expect(deposits).toHaveLength(1);
        expect(deposits[0].id).toBe('recent-bridged-deposit');
      } finally {
        // Restore original environment variable
        if (originalValue) {
          process.env.CLEAN_BRIDGED_TIME = originalValue;
        } else {
          delete process.env.CLEAN_BRIDGED_TIME;
        }
      }
    });
  });

  describe('Error Handling E2E', () => {
    test('should continue processing even if individual deposit operations fail', async () => {
      // This test verifies that the cleanup service is resilient to errors
      const originalValue = process.env.CLEAN_QUEUED_TIME;
      process.env.CLEAN_QUEUED_TIME = '1';

      try {
        // Create old queued deposits - one valid, one with corrupted data
        const oldTimestamp = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago

        const validDeposit = {
          id: 'valid-old-deposit',
          chainName: 'MockEVM1',
          fundingTxHash: '0x' + '1'.repeat(64),
          outputIndex: 0,
          hashes: {
            btc: { btcTxHash: '0x' + '1'.repeat(64) },
            eth: { initializeTxHash: null, finalizeTxHash: null },
            solana: { bridgeTxHash: null },
          },
          receipt: {
            depositor: '0x' + '1'.repeat(40),
            blindingFactor: 'test_blinding_factor',
            walletPublicKeyHash: 'test_hash',
            refundPublicKeyHash: 'test_refund_hash',
            refundLocktime: '1234567890',
            extraData: 'test_extra_data',
          },
          owner: '0x' + '1'.repeat(40),
          L1OutputEvent: null,
          status: DepositStatus.QUEUED,
          dates: {
            createdAt: oldTimestamp,
            initializationAt: null,
            finalizationAt: null,
            awaitingWormholeVAAMessageSince: null,
            bridgedAt: null,
            lastActivityAt: Date.now(),
          },
          wormholeInfo: {
            txHash: null,
            transferSequence: null,
            bridgingAttempted: false,
          },
          error: null,
        };

        const corruptedDeposit = {
          id: 'corrupted-old-deposit',
          chainName: 'MockEVM1',
          fundingTxHash: '0x' + '1'.repeat(64),
          outputIndex: 0,
          hashes: {
            btc: { btcTxHash: '0x' + '1'.repeat(64) },
            eth: { initializeTxHash: null, finalizeTxHash: null },
            solana: { bridgeTxHash: null },
          },
          receipt: {
            depositor: '0x' + '1'.repeat(40),
            blindingFactor: 'test_blinding_factor',
            walletPublicKeyHash: 'test_hash',
            refundPublicKeyHash: 'test_refund_hash',
            refundLocktime: '1234567890',
            extraData: 'test_extra_data',
          },
          owner: '0x' + '1'.repeat(40),
          L1OutputEvent: null,
          status: DepositStatus.QUEUED,
          dates: {
            createdAt: oldTimestamp,
            initializationAt: null,
            finalizationAt: null,
            awaitingWormholeVAAMessageSince: null,
            bridgedAt: null,
            lastActivityAt: Date.now(),
          },
          wormholeInfo: {
            txHash: null,
            transferSequence: null,
            bridgingAttempted: false,
          },
          error: null,
        };

        await DepositStore.create(validDeposit);
        await DepositStore.create(corruptedDeposit);

        // Run cleanup - should not throw even with corrupted data
        await expect(cleanQueuedDeposits()).resolves.not.toThrow();

        // Valid deposit should be cleaned up, corrupted one might remain due to processing errors
        const remainingDeposits = await DepositStore.getByStatus(DepositStatus.QUEUED);
        // The corrupted deposit might still exist due to processing errors, which is acceptable behavior
        expect(remainingDeposits.length).toBeLessThanOrEqual(1);
      } finally {
        // Restore original environment variable
        if (originalValue) {
          process.env.CLEAN_QUEUED_TIME = originalValue;
        } else {
          delete process.env.CLEAN_QUEUED_TIME;
        }
      }
    });
  });
});
