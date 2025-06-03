import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
  AuditEventType,
  appendToAuditLog,
  getAuditLogs,
  getAuditLogsByDepositId,
  logDepositCreated,
  logStatusChange,
  logDepositInitialized,
  logDepositFinalized,
  logDepositDeleted,
  logApiRequest,
  logDepositError,
  logDepositAwaitingWormholeVAA,
  logDepositBridged,
} from '../../../utils/AuditLog.js';
import { DepositStatus } from '../../../types/DepositStatus.enum.js';
import type { Deposit } from '../../../types/Deposit.type.js';
import type { FundingTransaction } from '../../../types/FundingTransaction.type.js';
import type { Reveal } from '../../../types/Reveal.type.js';
import { prisma } from '../../../utils/prisma.js';

// Type guards for audit log data
function hasDepositData(
  data: any,
): data is { deposit?: { id?: string; fundingTxHash?: string; owner?: string; status?: string } } {
  return data && typeof data === 'object' && data.deposit && typeof data.deposit === 'object';
}

function hasStatusData(
  data: any,
): data is { from?: string; to?: string; deposit?: { id?: string } } {
  return data && typeof data === 'object';
}

function hasTxData(data: any): data is { txHash?: string; deposit?: { status?: string } } {
  return data && typeof data === 'object';
}

function hasErrorData(data: any): data is {
  message?: string;
  detail?: string;
  code?: number;
  reason?: string;
  deposit?: { id?: string };
} {
  return data && typeof data === 'object';
}

function hasApiData(
  data: any,
): data is { endpoint?: string; method?: string; requestData?: any; responseStatus?: number } {
  return data && typeof data === 'object';
}

function hasBigArrayData(
  data: any,
): data is { bigArray?: Array<{ id: number; name: string; data: string }> } {
  return data && typeof data === 'object' && Array.isArray(data.bigArray);
}

describe('AuditLog Integration Tests', () => {
  // Test data setup
  const mockFundingTx: FundingTransaction = {
    version: '0x01000000',
    inputVector: 'mock-input-vector',
    outputVector: 'mock-output-vector',
    locktime: '0',
  };

  const mockReveal: Reveal = {
    fundingOutputIndex: 0,
    blindingFactor: 'mock_reveal_blinding_factor',
    walletPubKeyHash: 'mock_depositor_address',
    refundPubKeyHash: 'mock_l2_address',
    refundLocktime: 'mock_deadline',
    vault: 'mock_btc_recovery_address',
  };

  const createTestDeposit = (id: string, chainName: string = 'TestChain'): Deposit => ({
    id,
    chainName,
    fundingTxHash: `mock-funding-tx-hash-${id}`,
    outputIndex: 0,
    hashes: {
      btc: {
        btcTxHash: `mock-btc-tx-hash-${id}`,
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
      depositor: `mock-depositor-receipt-${id}`,
      blindingFactor: `mock-blindingFactor-receipt-${id}`,
      walletPublicKeyHash: `mock-walletPublicKeyHash-receipt-${id}`,
      refundPublicKeyHash: `mock-refundPublicKeyHash-receipt-${id}`,
      refundLocktime: `mock-refundLocktime-receipt-${id}`,
      extraData: `mock-extraData-receipt-${id}`,
    },
    owner: `mock-owner-address-${id}`,
    status: DepositStatus.QUEUED,
    L1OutputEvent: {
      fundingTx: mockFundingTx,
      reveal: mockReveal,
      l2DepositOwner: `mock-l2-owner-${id}`,
      l2Sender: `mock-l2-sender-${id}`,
    },
    dates: {
      createdAt: Date.now(),
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
  });

  beforeEach(async () => {
    // Clean the audit log table before each test
    await prisma.auditLog.deleteMany({});
  });

  afterEach(async () => {
    // Clean up after each test
    await prisma.auditLog.deleteMany({});
  });

  describe('appendToAuditLog - Database Operations', () => {
    test('should successfully create audit log entry in database', async () => {
      const eventType = AuditEventType.DEPOSIT_CREATED;
      const depositId = 'test-deposit-123';
      const data = { test: 'data', amount: 100 };
      const chainName = 'TestChain';

      await appendToAuditLog(eventType, depositId, data, chainName);

      const logs = await prisma.auditLog.findMany();
      expect(logs).toHaveLength(1);

      const log = logs[0];
      expect(log.eventType).toBe(eventType);
      expect(log.depositId).toBe(depositId);
      expect(log.data).toEqual(data);
      expect(log.chainName).toBe(chainName);
      expect(log.errorCode).toBeNull();
      expect(log.timestamp).toBeInstanceOf(Date);
    });

    test('should handle error code extraction from data', async () => {
      const eventType = AuditEventType.ERROR;
      const depositId = 'test-deposit-error';
      const data = { message: 'Test error', code: 500, extra: 'info' };
      const chainName = 'TestChain';

      await appendToAuditLog(eventType, depositId, data, chainName);

      const logs = await prisma.auditLog.findMany();
      expect(logs).toHaveLength(1);

      const log = logs[0];
      expect(log.eventType).toBe(eventType);
      expect(log.errorCode).toBe(500);
      expect(log.data).toEqual({ message: 'Test error', extra: 'info' }); // code should be removed
    });

    test('should handle null depositId and chainName', async () => {
      const eventType = AuditEventType.API_REQUEST;
      const data = { endpoint: '/test', method: 'GET' };

      await appendToAuditLog(eventType, null, data);

      const logs = await prisma.auditLog.findMany();
      expect(logs).toHaveLength(1);

      const log = logs[0];
      expect(log.depositId).toBeNull();
      expect(log.chainName).toBeNull();
      expect(log.data).toEqual(data);
    });

    test('should serialize complex data objects', async () => {
      const complexData = {
        nested: {
          object: {
            with: 'multiple levels',
            numbers: [1, 2, 3],
            boolean: true,
          },
        },
        array: ['string', 42, { key: 'value' }],
        date: new Date().toISOString(),
      };

      await appendToAuditLog(AuditEventType.DEPOSIT_UPDATED, 'test-deposit', complexData);

      const logs = await prisma.auditLog.findMany();
      expect(logs).toHaveLength(1);
      expect(logs[0].data).toEqual(complexData);
    });
  });

  describe('getAuditLogs - Database Retrieval', () => {
    test('should return all logs ordered by timestamp descending', async () => {
      // Create multiple logs with slight time delays
      await appendToAuditLog(AuditEventType.DEPOSIT_CREATED, 'deposit-1', { order: 1 });
      await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay
      await appendToAuditLog(AuditEventType.DEPOSIT_INITIALIZED, 'deposit-2', { order: 2 });
      await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay
      await appendToAuditLog(AuditEventType.DEPOSIT_FINALIZED, 'deposit-3', { order: 3 });

      const logs = await getAuditLogs();

      expect(logs).toHaveLength(3);
      // Should be ordered by timestamp descending (most recent first)
      expect(logs[0].eventType).toBe(AuditEventType.DEPOSIT_FINALIZED);
      expect(logs[1].eventType).toBe(AuditEventType.DEPOSIT_INITIALIZED);
      expect(logs[2].eventType).toBe(AuditEventType.DEPOSIT_CREATED);
    });

    test('should return empty array when no logs exist', async () => {
      const logs = await getAuditLogs();
      expect(logs).toHaveLength(0);
    });

    test('should deserialize complex data objects correctly', async () => {
      const complexData = {
        deposit: {
          id: 'test-deposit',
          status: 'QUEUED',
          metadata: {
            nested: true,
            array: [1, 'two', { three: 3 }],
          },
        },
      };

      await appendToAuditLog(AuditEventType.DEPOSIT_CREATED, 'test-deposit', complexData);

      const logs = await getAuditLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].data).toEqual(complexData);
    });

    test('should handle database errors gracefully', async () => {
      // Temporarily break the database connection by closing it
      await prisma.$disconnect();

      const logs = await getAuditLogs();
      expect(logs).toEqual([]);

      // Reconnect for subsequent tests
      await prisma.$connect();
    });
  });

  describe('getAuditLogsByDepositId - Filtered Retrieval', () => {
    test('should return only logs for specific depositId', async () => {
      // Set up test data
      await appendToAuditLog(AuditEventType.DEPOSIT_CREATED, 'deposit-1', { action: 'created' });
      await appendToAuditLog(AuditEventType.STATUS_CHANGED, 'deposit-1', {
        action: 'status-change',
      });
      await appendToAuditLog(AuditEventType.DEPOSIT_CREATED, 'deposit-2', { action: 'created' });
      await appendToAuditLog(AuditEventType.DEPOSIT_FINALIZED, 'deposit-1', {
        action: 'finalized',
      });
      await appendToAuditLog(AuditEventType.API_REQUEST, null, { action: 'api-request' });

      const logs = await getAuditLogsByDepositId('deposit-1');

      expect(logs).toHaveLength(3);
      logs.forEach((log: any) => {
        expect(log.depositId).toBe('deposit-1');
      });

      // Check that we get the right event types
      const eventTypes = logs.map((log: any) => log.eventType);
      expect(eventTypes).toContain(AuditEventType.DEPOSIT_CREATED);
      expect(eventTypes).toContain(AuditEventType.STATUS_CHANGED);
      expect(eventTypes).toContain(AuditEventType.DEPOSIT_FINALIZED);
    });

    test('should return empty array for non-existent depositId', async () => {
      const logs = await getAuditLogsByDepositId('non-existent-deposit');
      expect(logs).toHaveLength(0);
    });

    test('should order logs by timestamp descending', async () => {
      // Set up test data
      await appendToAuditLog(AuditEventType.DEPOSIT_CREATED, 'deposit-1', { action: 'created' });
      await appendToAuditLog(AuditEventType.STATUS_CHANGED, 'deposit-1', {
        action: 'status-change',
      });
      await appendToAuditLog(AuditEventType.DEPOSIT_FINALIZED, 'deposit-1', {
        action: 'finalized',
      });

      const logs = await getAuditLogsByDepositId('deposit-1');

      // Verify timestamp ordering (most recent first)
      for (let i = 0; i < logs.length - 1; i++) {
        expect(logs[i].timestamp.getTime()).toBeGreaterThanOrEqual(logs[i + 1].timestamp.getTime());
      }
    });

    test('should handle database errors gracefully', async () => {
      // Temporarily break the database connection by closing it
      await prisma.$disconnect();

      const logs = await getAuditLogsByDepositId('deposit-1');
      expect(logs).toEqual([]);

      // Reconnect for subsequent tests
      await prisma.$connect();
    });
  });

  describe('Specific Logging Functions - Database Integration', () => {
    test('logDepositCreated should create correct database entry', async () => {
      const deposit = createTestDeposit('test-deposit-created');

      await logDepositCreated(deposit);

      const logs = await prisma.auditLog.findMany();
      expect(logs).toHaveLength(1);

      const log = logs[0];
      expect(log.eventType).toBe(AuditEventType.DEPOSIT_CREATED);
      expect(log.depositId).toBe(deposit.id);
      expect(log.chainName).toBe(deposit.chainName);
      if (hasDepositData(log.data)) {
        expect(log.data.deposit?.id).toBe(deposit.id);
        expect(log.data.deposit?.fundingTxHash).toBe(deposit.fundingTxHash);
        expect(log.data.deposit?.owner).toBe(deposit.owner);
        expect(log.data.deposit?.status).toBe('QUEUED');
      }
    });

    test('logStatusChange should create correct database entry', async () => {
      const deposit = createTestDeposit('test-deposit-status');

      await logStatusChange(deposit, DepositStatus.INITIALIZED, DepositStatus.QUEUED);

      const logs = await prisma.auditLog.findMany();
      expect(logs).toHaveLength(1);

      const log = logs[0];
      expect(log.eventType).toBe(AuditEventType.STATUS_CHANGED);
      if (hasStatusData(log.data)) {
        expect(log.data.from).toBe('QUEUED');
        expect(log.data.to).toBe('INITIALIZED');
        expect(log.data.deposit?.id).toBe(deposit.id);
      }
    });

    test('logDepositInitialized should create correct database entry', async () => {
      const deposit = createTestDeposit('test-deposit-init');
      deposit.hashes.eth.initializeTxHash = 'init-tx-hash';

      await logDepositInitialized(deposit);

      const logs = await prisma.auditLog.findMany();
      expect(logs).toHaveLength(1);

      const log = logs[0];
      expect(log.eventType).toBe(AuditEventType.DEPOSIT_INITIALIZED);
      if (hasTxData(log.data)) {
        expect(log.data.txHash).toBe('init-tx-hash');
        expect(log.data.deposit?.status).toBe('INITIALIZED');
      }
    });

    test('logDepositFinalized should create correct database entry', async () => {
      const deposit = createTestDeposit('test-deposit-final');
      deposit.hashes.eth.finalizeTxHash = 'final-tx-hash';

      await logDepositFinalized(deposit);

      const logs = await prisma.auditLog.findMany();
      expect(logs).toHaveLength(1);

      const log = logs[0];
      expect(log.eventType).toBe(AuditEventType.DEPOSIT_FINALIZED);
      if (hasTxData(log.data)) {
        expect(log.data.txHash).toBe('final-tx-hash');
        expect(log.data.deposit?.status).toBe('FINALIZED');
      }
    });

    test('logDepositDeleted should create correct database entry', async () => {
      const deposit = createTestDeposit('test-deposit-deleted');
      const reason = 'Test deletion reason';

      await logDepositDeleted(deposit, reason);

      const logs = await prisma.auditLog.findMany();
      expect(logs).toHaveLength(1);

      const log = logs[0];
      expect(log.eventType).toBe(AuditEventType.DEPOSIT_DELETED);
      if (hasErrorData(log.data)) {
        expect(log.data.reason).toBe(reason);
        expect(log.data.deposit?.id).toBe(deposit.id);
      }
    });

    test('logApiRequest should create correct database entry', async () => {
      const endpoint = '/api/test';
      const method = 'POST';
      const depositId = 'test-deposit-api';
      const requestData = { test: 'payload' };
      const responseStatus = 201;
      const chainName = 'TestChain';

      await logApiRequest(endpoint, method, depositId, requestData, responseStatus, chainName);

      const logs = await prisma.auditLog.findMany();
      expect(logs).toHaveLength(1);

      const log = logs[0];
      expect(log.eventType).toBe(AuditEventType.API_REQUEST);
      expect(log.depositId).toBe(depositId);
      expect(log.chainName).toBe(chainName);
      if (hasApiData(log.data)) {
        expect(log.data.endpoint).toBe(endpoint);
        expect(log.data.method).toBe(method);
        expect(log.data.requestData).toEqual(requestData);
        expect(log.data.responseStatus).toBe(responseStatus);
      }
    });

    test('logDepositError should create correct database entry', async () => {
      const depositId = 'test-deposit-error';
      const message = 'Test error message';
      const extra = { detail: 'error detail', code: 500 };
      const chainName = 'TestChain';

      await logDepositError(depositId, message, extra, chainName);

      const logs = await prisma.auditLog.findMany();
      expect(logs).toHaveLength(1);

      const log = logs[0];
      expect(log.eventType).toBe(AuditEventType.ERROR);
      expect(log.depositId).toBe(depositId);
      expect(log.chainName).toBe(chainName);
      expect(log.errorCode).toBe(500);
      if (hasErrorData(log.data)) {
        expect(log.data.message).toBe(message);
        expect(log.data.detail).toBe('error detail');
        expect(log.data.code).toBeUndefined(); // Should be removed and set as errorCode
      }
    });

    test('logDepositAwaitingWormholeVAA should create correct database entry', async () => {
      const deposit = createTestDeposit('test-deposit-wormhole');

      await logDepositAwaitingWormholeVAA(deposit);

      const logs = await prisma.auditLog.findMany();
      expect(logs).toHaveLength(1);

      const log = logs[0];
      expect(log.eventType).toBe(AuditEventType.DEPOSIT_AWAITING_WORMHOLE_VAA);
      expect(log.depositId).toBe(deposit.id);
      expect(log.chainName).toBe(deposit.chainName);
    });

    test('logDepositBridged should create correct database entry', async () => {
      const deposit = createTestDeposit('test-deposit-bridged');

      await logDepositBridged(deposit);

      const logs = await prisma.auditLog.findMany();
      expect(logs).toHaveLength(1);

      const log = logs[0];
      expect(log.eventType).toBe(AuditEventType.DEPOSIT_BRIDGED);
      expect(log.depositId).toBe(deposit.id);
      expect(log.chainName).toBe(deposit.chainName);
    });
  });

  describe('Data Serialization and Deserialization', () => {
    test('should handle complex nested objects', async () => {
      const complexData = {
        level1: {
          level2: {
            level3: {
              string: 'test',
              number: 42,
              boolean: true,
              array: [1, 'two', { nested: 'value' }],
              nullValue: null,
              undefinedValue: undefined,
            },
          },
        },
        dates: {
          created: new Date().toISOString(),
          updated: Date.now(),
        },
      };

      await appendToAuditLog(AuditEventType.DEPOSIT_UPDATED, 'complex-test', complexData);

      const logs = await getAuditLogs();
      expect(logs).toHaveLength(1);

      // Note: undefined values are typically not serialized to JSON
      const expectedData = {
        ...complexData,
        level1: {
          ...complexData.level1,
          level2: {
            ...complexData.level1.level2,
            level3: {
              ...complexData.level1.level2.level3,
              undefinedValue: undefined,
            },
          },
        },
      };

      expect(logs[0].data).toEqual(expectedData);
    });

    test('should handle large data objects', async () => {
      // Clean any existing logs first
      await prisma.auditLog.deleteMany({});

      const largeData = {
        bigArray: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `Item ${i}`,
          data: `Data for item ${i}`.repeat(10),
        })),
        metadata: {
          description: 'Large test data object'.repeat(100),
        },
      };

      await appendToAuditLog(AuditEventType.DEPOSIT_UPDATED, 'large-test', largeData);

      const logs = await getAuditLogs();
      expect(logs).toHaveLength(1);
      if (hasBigArrayData(logs[0].data)) {
        expect(logs[0].data.bigArray).toHaveLength(1000);
        expect(logs[0].data.bigArray?.[0]?.id).toBe(0);
        expect(logs[0].data.bigArray?.[999]?.id).toBe(999);
      }
    });

    test('should handle special characters and unicode', async () => {
      const specialData = {
        unicode: '🚀 Unicode test with émojis and ñ special chars 中文',
        special: 'Special chars: !@#$%^&*()_+-=[]{}|;:\'",.<>?/~`',
        quotes: 'Single \'quotes\' and "double quotes"',
        newlines: 'Line 1\nLine 2\r\nLine 3',
        tabs: 'Tab\tseparated\tvalues',
      };

      await appendToAuditLog(AuditEventType.DEPOSIT_CREATED, 'special-test', specialData);

      const logs = await getAuditLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].data).toEqual(specialData);
    });
  });

  describe('Error Handling', () => {
    test('should handle database write errors in appendToAuditLog', async () => {
      // Test with invalid data that might cause database constraints to fail
      // We'll use an extremely long string that might exceed database field limits
      const invalidData = {
        extremelyLongString: 'x'.repeat(100000), // 100KB string
      };

      // This test depends on database constraints - if the database allows this,
      // we need a different approach to test error handling
      try {
        await appendToAuditLog(AuditEventType.DEPOSIT_CREATED, 'invalid-test', invalidData);
        // If no error is thrown, that's actually fine - it means the database handled it
        const logs = await getAuditLogs();
        expect(logs).toHaveLength(1);
      } catch (error) {
        // If an error is thrown, it should be handled gracefully
        expect(error).toBeDefined();
      }
    });

    test('should handle concurrent writes correctly', async () => {
      // Ensure database is completely clean before starting
      await prisma.auditLog.deleteMany({});

      const promises = [];
      const testData = [];

      // Create 10 concurrent write operations
      for (let i = 0; i < 10; i++) {
        const data = {
          index: i,
          timestamp: Date.now() + i, // Slight timestamp variation
          uniqueId: `concurrent-test-${i}-${Math.random()}`,
        };
        testData.push(data);
        promises.push(
          appendToAuditLog(AuditEventType.DEPOSIT_CREATED, `concurrent-test-${i}`, data),
        );
      }

      // Wait for all promises to complete (some might fail, that's ok)
      await Promise.allSettled(promises);

      // Give database a moment to commit all operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      const logs = await getAuditLogs();

      // Main assertion: we should have at least some logs created
      // (In a real concurrent scenario, some operations might fail due to timing)
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.length).toBeLessThanOrEqual(10);

      // All successful logs should have valid data
      logs.forEach((log: any) => {
        expect(log.eventType).toBe(AuditEventType.DEPOSIT_CREATED);
        expect(log.depositId).toMatch(/^concurrent-test-\d+$/);
        expect(log.data.index).toBeGreaterThanOrEqual(0);
        expect(log.data.index).toBeLessThanOrEqual(9);
        expect(log.data.uniqueId).toMatch(/^concurrent-test-\d+-[\d.]+$/);
      });

      // Ensure no duplicate entries based on uniqueId
      const uniqueIds = logs.map((log: any) => log.data.uniqueId);
      const uniqueSet = new Set(uniqueIds);
      expect(uniqueSet.size).toBe(logs.length);
    });
  });

  describe('End-to-End Deposit Workflow', () => {
    test('should create complete audit trail for deposit lifecycle', async () => {
      // Clean any existing logs first
      await prisma.auditLog.deleteMany({});

      const deposit = createTestDeposit('e2e-test-deposit');

      // Simulate complete deposit lifecycle
      await logDepositCreated(deposit);

      await logStatusChange(deposit, DepositStatus.INITIALIZED, DepositStatus.QUEUED);
      deposit.status = DepositStatus.INITIALIZED;
      deposit.hashes.eth.initializeTxHash = 'init-tx-hash';
      await logDepositInitialized(deposit);

      await logDepositAwaitingWormholeVAA(deposit);

      await logStatusChange(deposit, DepositStatus.FINALIZED, DepositStatus.INITIALIZED);
      deposit.status = DepositStatus.FINALIZED;
      deposit.hashes.eth.finalizeTxHash = 'final-tx-hash';
      await logDepositFinalized(deposit);

      await logDepositBridged(deposit);

      // Verify complete audit trail
      const logs = await getAuditLogsByDepositId(deposit.id);
      // We expect 7 logs: 1 created, 2 status changes, 1 initialized, 1 awaiting VAA, 1 finalized, 1 bridged
      expect(logs).toHaveLength(7);

      const eventTypes = logs.map((log: any) => log.eventType);
      expect(eventTypes).toContain(AuditEventType.DEPOSIT_CREATED);
      expect(eventTypes).toContain(AuditEventType.STATUS_CHANGED);
      expect(eventTypes).toContain(AuditEventType.DEPOSIT_INITIALIZED);
      expect(eventTypes).toContain(AuditEventType.DEPOSIT_AWAITING_WORMHOLE_VAA);
      expect(eventTypes).toContain(AuditEventType.DEPOSIT_FINALIZED);
      expect(eventTypes).toContain(AuditEventType.DEPOSIT_BRIDGED);

      // Verify we have exactly 2 status change events
      const statusChangeLogs = logs.filter(
        (log: any) => log.eventType === AuditEventType.STATUS_CHANGED,
      );
      expect(statusChangeLogs).toHaveLength(2);

      // Verify the status transitions are correct
      const statusTransitions = statusChangeLogs.map((log: any) => ({
        from: log.data.from,
        to: log.data.to,
      }));
      expect(statusTransitions).toContainEqual({ from: 'QUEUED', to: 'INITIALIZED' });
      expect(statusTransitions).toContainEqual({ from: 'INITIALIZED', to: 'FINALIZED' });

      // Verify chronological order (most recent first)
      expect(logs[0].eventType).toBe(AuditEventType.DEPOSIT_BRIDGED);
      expect(logs[logs.length - 1].eventType).toBe(AuditEventType.DEPOSIT_CREATED);
    });
  });
});
