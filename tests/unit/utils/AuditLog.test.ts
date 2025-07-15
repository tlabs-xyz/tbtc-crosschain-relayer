import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { DepositStatus as DepositStatusEnum } from '../../../types/DepositStatus.enum.js';

// Mock Prisma client
jest.mock('../../../utils/prisma.js', () => ({
  prisma: {
    auditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

// Import after mocking
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
} from '../../../utils/AuditLog.js';
import { prisma } from '../../../utils/prisma.js';

const testDeposit = {
  id: 'test-id',
  fundingTxHash: '0xfundingtxhash',
  outputIndex: 0,
  hashes: { btc: { btcTxHash: '0xbtc' }, eth: { initializeTxHash: null, finalizeTxHash: null } },
  receipt: {
    depositor: '0xdepositor',
    blindingFactor: '0xblinding',
    walletPublicKeyHash: '0xwallet',
    refundPublicKeyHash: '0xrefund',
    refundLocktime: '0xlock',
    extraData: '0xextra',
  },
  owner: '0xowner',
  status: DepositStatusEnum.QUEUED,
  L1OutputEvent: {
    l2DepositOwner: '0xl2owner',
    l2Sender: '0xl2sender',
  },
  dates: {
    createdAt: Date.now(),
    initializationAt: null,
    finalizationAt: null,
    lastActivityAt: Date.now(),
  },
  error: null,
};

describe('AuditLog', () => {
  const mockCreate = prisma.auditLog.create as jest.MockedFunction<typeof prisma.auditLog.create>;
  const mockFindMany = prisma.auditLog.findMany as jest.MockedFunction<
    typeof prisma.auditLog.findMany
  >;
  const mockDeleteMany = prisma.auditLog.deleteMany as jest.MockedFunction<
    typeof prisma.auditLog.deleteMany
  >;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('appendToAuditLog writes entry to DB', async () => {
    const mockEntry = {
      id: 'test-audit-id',
      eventType: AuditEventType.DEPOSIT_CREATED,
      depositId: testDeposit.id,
      data: { foo: 'bar' },
    };
    mockCreate.mockResolvedValue(mockEntry);

    await appendToAuditLog(AuditEventType.DEPOSIT_CREATED, testDeposit.id, { foo: 'bar' });

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        eventType: AuditEventType.DEPOSIT_CREATED,
        depositId: testDeposit.id,
        data: { foo: 'bar' },
        errorCode: undefined,
      },
    });
  });

  test('getAuditLogs returns all logs', async () => {
    const mockLogs = [
      { eventType: AuditEventType.DEPOSIT_CREATED, depositId: testDeposit.id },
      { eventType: AuditEventType.DEPOSIT_FINALIZED, depositId: testDeposit.id },
    ];
    mockFindMany.mockResolvedValue(mockLogs);

    const logs = await getAuditLogs();

    expect(logs).toEqual(mockLogs);
    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { timestamp: 'desc' },
    });
  });

  test('getAuditLogsByDepositId returns only relevant logs', async () => {
    const mockLogs = [{ eventType: AuditEventType.DEPOSIT_CREATED, depositId: testDeposit.id }];
    mockFindMany.mockResolvedValue(mockLogs);

    const logs = await getAuditLogsByDepositId(testDeposit.id);

    expect(logs).toEqual(mockLogs);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { depositId: testDeposit.id },
      orderBy: { timestamp: 'desc' },
    });
  });

  test('logDepositCreated writes correct event', async () => {
    const mockEntry = {
      eventType: AuditEventType.DEPOSIT_CREATED,
      depositId: testDeposit.id,
    };
    mockCreate.mockResolvedValue(mockEntry);

    await logDepositCreated(testDeposit as any);

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        eventType: AuditEventType.DEPOSIT_CREATED,
        depositId: testDeposit.id,
        data: {
          deposit: {
            id: testDeposit.id,
            fundingTxHash: testDeposit.fundingTxHash,
            owner: testDeposit.owner,
            l2DepositOwner: '0xl2owner',
            status: 'QUEUED',
            createdAt: testDeposit.dates.createdAt,
          },
        },
        errorCode: undefined,
      },
    });
  });

  test('logStatusChange writes correct event', async () => {
    const mockEntry = {
      eventType: AuditEventType.STATUS_CHANGED,
      depositId: testDeposit.id,
    };
    mockCreate.mockResolvedValue(mockEntry);

    await logStatusChange(
      testDeposit as any,
      DepositStatusEnum.INITIALIZED,
      DepositStatusEnum.QUEUED,
    );

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        eventType: AuditEventType.STATUS_CHANGED,
        depositId: testDeposit.id,
        data: {
          from: 'QUEUED',
          to: 'INITIALIZED',
          deposit: {
            id: testDeposit.id,
            fundingTxHash: testDeposit.fundingTxHash,
            owner: testDeposit.owner,
            dates: testDeposit.dates,
          },
        },
        errorCode: undefined,
      },
    });
  });

  test('logDepositInitialized writes correct event', async () => {
    const mockEntry = {
      eventType: AuditEventType.DEPOSIT_INITIALIZED,
      depositId: testDeposit.id,
    };
    mockCreate.mockResolvedValue(mockEntry);

    await logDepositInitialized(testDeposit as any);

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        eventType: AuditEventType.DEPOSIT_INITIALIZED,
        depositId: testDeposit.id,
        data: {
          deposit: {
            id: testDeposit.id,
            fundingTxHash: testDeposit.fundingTxHash,
            owner: testDeposit.owner,
            l2DepositOwner: '0xl2owner',
            status: 'INITIALIZED',
            initializedAt: testDeposit.dates.initializationAt,
          },
          txHash: testDeposit.hashes.eth.initializeTxHash,
        },
        errorCode: undefined,
      },
    });
  });

  test('logDepositFinalized writes correct event', async () => {
    const mockEntry = {
      eventType: AuditEventType.DEPOSIT_FINALIZED,
      depositId: testDeposit.id,
    };
    mockCreate.mockResolvedValue(mockEntry);

    await logDepositFinalized(testDeposit as any);

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        eventType: AuditEventType.DEPOSIT_FINALIZED,
        depositId: testDeposit.id,
        data: {
          deposit: {
            id: testDeposit.id,
            fundingTxHash: testDeposit.fundingTxHash,
            owner: testDeposit.owner,
            l2DepositOwner: '0xl2owner',
            status: 'FINALIZED',
            finalizedAt: testDeposit.dates.finalizationAt,
          },
          txHash: testDeposit.hashes.eth.finalizeTxHash,
        },
        errorCode: undefined,
      },
    });
  });

  test('logDepositDeleted writes correct event', async () => {
    const mockEntry = {
      eventType: AuditEventType.DEPOSIT_DELETED,
      depositId: testDeposit.id,
    };
    mockCreate.mockResolvedValue(mockEntry);

    await logDepositDeleted(testDeposit as any, 'test reason');

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        eventType: AuditEventType.DEPOSIT_DELETED,
        depositId: testDeposit.id,
        data: {
          deposit: {
            id: testDeposit.id,
            fundingTxHash: testDeposit.fundingTxHash,
            owner: testDeposit.owner,
            l2DepositOwner: '0xl2owner',
            status: testDeposit.status,
            createdAt: testDeposit.dates.createdAt,
            initializedAt: testDeposit.dates.initializationAt,
            finalizedAt: testDeposit.dates.finalizationAt,
          },
          reason: 'test reason',
        },
        errorCode: undefined,
      },
    });
  });

  test('logApiRequest writes correct event', async () => {
    const mockEntry = {
      eventType: AuditEventType.API_REQUEST,
      depositId: testDeposit.id,
    };
    mockCreate.mockResolvedValue(mockEntry);

    await logApiRequest('/api/test', 'POST', testDeposit.id, { test: 'payload' }, 201);

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        eventType: AuditEventType.API_REQUEST,
        depositId: testDeposit.id,
        data: {
          endpoint: '/api/test',
          method: 'POST',
          requestData: { test: 'payload' },
          responseStatus: 201,
        },
        errorCode: undefined,
      },
    });
  });

  test('logDepositError writes correct event', async () => {
    const mockEntry = {
      eventType: AuditEventType.ERROR,
      depositId: testDeposit.id,
      errorCode: 500,
    };
    mockCreate.mockResolvedValue(mockEntry);

    await logDepositError(testDeposit.id, 'A test error occurred', { code: 500 });

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        eventType: AuditEventType.ERROR,
        depositId: testDeposit.id,
        data: { message: 'A test error occurred' },
        errorCode: 500,
      },
    });
  });
});
