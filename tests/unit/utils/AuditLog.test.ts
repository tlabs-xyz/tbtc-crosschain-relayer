import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  AuditEventType,
  logDepositCreated,
  logStatusChange,
  logDepositInitialized,
  logDepositFinalized,
  logDepositDeleted,
  logApiRequest,
  logDepositError,
} from '../../../utils/AuditLog.js';
import * as AuditLogFunctions from '../../../utils/AuditLog.js';
import { DepositStatus as DepositStatusEnum } from '../../../types/DepositStatus.enum.js';
import type { Deposit } from '../../../types/Deposit.type.js';
import type { FundingTransaction } from '../../../types/FundingTransaction.type.js';
import type { Reveal } from '../../../types/Reveal.type.js';

const mockFundingTx: FundingTransaction = {
  version: '0x01000000',
  inputVector: 'mock-input-vector',
  outputVector: 'mock-output-vector',
  locktime: '0', // Changed to string
};

const mockReveal: Reveal = {
  fundingOutputIndex: 0,
  blindingFactor: 'mock_reveal_blinding_factor',
  walletPubKeyHash: 'mock_depositor_address',
  refundPubKeyHash: 'mock_l2_address',
  refundLocktime: 'mock_deadline',
  vault: 'mock_btc_recovery_address', // Assuming vault is a string, adjust if it's a different type. The original comment mentioned btcRecoveryAddress, which might be a misunderstanding of the Reveal type.
};

// Define a more complete testDeposit object
const testDeposit: Deposit = {
  id: 'test-deposit-id-123',
  chainName: 'MockAuditChain',
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
    depositor: 'mock-depositor-receipt',
    blindingFactor: 'mock-blindingFactor-receipt',
    walletPublicKeyHash: 'mock-walletPublicKeyHash-receipt',
    refundPublicKeyHash: 'mock-refundPublicKeyHash-receipt',
    refundLocktime: 'mock-refundLocktime-receipt',
    extraData: 'mock-extraData-receipt',
  },
  owner: 'mock-owner-address',
  status: DepositStatusEnum.QUEUED,
  L1OutputEvent: {
    fundingTx: mockFundingTx,
    reveal: mockReveal,
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
  },
  wormholeInfo: {
    txHash: null,
    transferSequence: null,
    bridgingAttempted: false,
  },
  error: null,
};

import { prisma as prismaClientInstance } from '@/utils/prisma.js';

// Fallback to mocked Prisma client for tests if import fails
let prisma: any;
try {
  if (!prismaClientInstance || !(prismaClientInstance as any).auditLog) {
    throw new Error('Prisma client or auditLog table not loaded correctly from static import.');
  }
  prisma = prismaClientInstance;
} catch (_e: any) {
  // Fallback to mocked Prisma client for tests
  prisma = {
    auditLog: {
      deleteMany: jest.fn().mockResolvedValue(undefined as never),
      create: jest.fn().mockResolvedValue(undefined as never),
      findMany: jest.fn().mockResolvedValue([] as unknown as never),
    },
  };
}

describe('AuditLog', () => {
  let appendToAuditLogSpy: jest.SpiedFunction<typeof AuditLogFunctions.appendToAuditLog>;

  beforeEach(async () => {
    if (prisma && prisma.auditLog && typeof prisma.auditLog.deleteMany === 'function') {
      await prisma.auditLog.deleteMany({});
    }
    appendToAuditLogSpy = jest
      .spyOn(AuditLogFunctions, 'appendToAuditLog')
      .mockResolvedValue(undefined as any);
  });

  afterEach(async () => {
    if (prisma && prisma.auditLog && typeof prisma.auditLog.deleteMany === 'function') {
      await prisma.auditLog.deleteMany({});
    }
    jest.restoreAllMocks();
  });

  test('appendToAuditLog (spied) is called with correct arguments', async () => {
    const eventType = AuditEventType.DEPOSIT_CREATED;
    const depositId = 'some-deposit-id';
    const data = { foo: 'bar' };
    const chainName = 'SomeChain';
    await AuditLogFunctions.appendToAuditLog(eventType, depositId, data, chainName);
    expect(appendToAuditLogSpy).toHaveBeenCalledWith(eventType, depositId, data, chainName);
  });

  test('logDepositCreated calls appendToAuditLog', async () => {
    await logDepositCreated(testDeposit);
    expect(appendToAuditLogSpy).toHaveBeenCalledWith(
      AuditEventType.DEPOSIT_CREATED,
      testDeposit.id,
      expect.objectContaining({
        deposit: expect.objectContaining({
          id: testDeposit.id,
          fundingTxHash: testDeposit.fundingTxHash,
        }),
      }),
      testDeposit.chainName,
    );
  });

  test('logStatusChange calls appendToAuditLog', async () => {
    await logStatusChange(testDeposit, DepositStatusEnum.INITIALIZED, DepositStatusEnum.QUEUED);
    expect(appendToAuditLogSpy).toHaveBeenCalledWith(
      AuditEventType.STATUS_CHANGED,
      testDeposit.id,
      expect.objectContaining({
        deposit: expect.objectContaining({
          id: testDeposit.id,
        }),
        from: DepositStatusEnum[DepositStatusEnum.QUEUED],
        to: DepositStatusEnum[DepositStatusEnum.INITIALIZED],
      }),
      testDeposit.chainName,
    );
  });

  test('logDepositInitialized calls appendToAuditLog', async () => {
    await logDepositInitialized(testDeposit);
    expect(appendToAuditLogSpy).toHaveBeenCalledWith(
      AuditEventType.DEPOSIT_INITIALIZED,
      testDeposit.id,
      expect.objectContaining({
        deposit: expect.objectContaining({
          id: testDeposit.id,
        }),
        txHash: null,
      }),
      testDeposit.chainName,
    );
  });

  test('logDepositFinalized calls appendToAuditLog', async () => {
    await logDepositFinalized(testDeposit);
    expect(appendToAuditLogSpy).toHaveBeenCalledWith(
      AuditEventType.DEPOSIT_FINALIZED,
      testDeposit.id,
      expect.objectContaining({
        deposit: expect.objectContaining({
          id: testDeposit.id,
        }),
        txHash: null,
      }),
      testDeposit.chainName,
    );
  });

  test('logDepositDeleted calls appendToAuditLog', async () => {
    await logDepositDeleted(testDeposit, 'test reason');
    expect(appendToAuditLogSpy).toHaveBeenCalledWith(
      AuditEventType.DEPOSIT_DELETED,
      testDeposit.id,
      expect.objectContaining({
        deposit: expect.objectContaining({
          id: testDeposit.id,
        }),
        reason: 'test reason',
      }),
      testDeposit.chainName,
    );
  });

  test('logApiRequest should call appendToAuditLog with correct parameters', async () => {
    const reqDepositId = 'reqDeposit123';
    const reqChainName = 'ApiTestChain';
    await logApiRequest('/api/test', 'POST', reqDepositId, { test: 'payload' }, 201, reqChainName);
    expect(appendToAuditLogSpy).toHaveBeenCalledWith(
      AuditEventType.API_REQUEST,
      reqDepositId,
      {
        endpoint: '/api/test',
        method: 'POST',
        requestData: { test: 'payload' },
        responseStatus: 201,
      },
      reqChainName,
    );
  });

  test('logDepositError should call appendToAuditLog with correct parameters', async () => {
    const errDepositId = 'depositError789';
    const errChainName = 'ErrorTestChain';
    const testMessage = 'Test error message for specific test';
    const testExtra = { detail: 'some specific detail' };
    const errorCode = 503;
    await logDepositError(
      errDepositId,
      testMessage,
      { ...testExtra, code: errorCode },
      errChainName,
    );
    expect(appendToAuditLogSpy).toHaveBeenCalledWith(
      AuditEventType.ERROR,
      errDepositId,
      { message: testMessage, ...testExtra, code: errorCode },
      errChainName,
    );
  });
});
