import { prisma } from './prisma.js';
import { DepositStatus } from '../types/DepositStatus.enum.js';
import type { Deposit } from '../types/Deposit.type.js';
import { logErrorContext } from './Logger.js';

// Event types
export enum AuditEventType {
  DEPOSIT_CREATED = 'DEPOSIT_CREATED',
  DEPOSIT_UPDATED = 'DEPOSIT_UPDATED',
  STATUS_CHANGED = 'STATUS_CHANGED',
  DEPOSIT_INITIALIZED = 'DEPOSIT_INITIALIZED',
  DEPOSIT_FINALIZED = 'DEPOSIT_FINALIZED',
  DEPOSIT_DELETED = 'DEPOSIT_DELETED',
  DEPOSIT_AWAITING_WORMHOLE_VAA = 'DEPOSIT_AWAITING_WORMHOLE_VAA',
  DEPOSIT_BRIDGED = 'DEPOSIT_BRIDGED',
  ERROR = 'ERROR',
  API_REQUEST = 'API_REQUEST',
}

/**
 * Append an event to the audit log (DB)
 * @param eventType Type of the event
 * @param depositId ID of the deposit
 * @param data Additional data to log
 * @param chainName Optional chain name
 */
export const appendToAuditLog = async (
  eventType: AuditEventType,
  depositId: string | null,
  data: any,
  chainName?: string,
): Promise<void> => {
  let errorCode: number | undefined = undefined;
  if (data && typeof data.code === 'number') {
    errorCode = data.code;
    // Remove code from data to avoid duplication
    const { code, ...rest } = data;
    data = rest;
  }
  await prisma.auditLog.create({
    data: {
      eventType,
      depositId,
      data,
      errorCode,
      chainName,
    },
  });
};

/**
 * Get all audit logs
 */
export const getAuditLogs = async () => {
  try {
    return await prisma.auditLog.findMany({ orderBy: { timestamp: 'desc' } });
  } catch (error) {
    logErrorContext('Failed to fetch audit logs', error);
    return [];
  }
};

/**
 * Get audit logs by depositId
 */
export const getAuditLogsByDepositId = async (depositId: string) => {
  try {
    return await prisma.auditLog.findMany({
      where: { depositId },
      orderBy: { timestamp: 'desc' },
    });
  } catch (error) {
    logErrorContext('Failed to fetch audit logs by depositId', error);
    return [];
  }
};

/**
 * Log status changes for a deposit
 */
export const logStatusChange = async (
  deposit: Deposit,
  newStatus: DepositStatus,
  oldStatus?: DepositStatus,
): Promise<void> => {
  const statusMap = {
    [DepositStatus.QUEUED]: 'QUEUED',
    [DepositStatus.INITIALIZED]: 'INITIALIZED',
    [DepositStatus.FINALIZED]: 'FINALIZED',
    [DepositStatus.AWAITING_WORMHOLE_VAA]: 'AWAITING_WORMHOLE_VAA',
    [DepositStatus.BRIDGED]: 'BRIDGED',
  };
  await appendToAuditLog(
    AuditEventType.STATUS_CHANGED,
    deposit.id,
    {
      from: oldStatus !== undefined ? statusMap[oldStatus] : 'UNKNOWN',
      to: statusMap[newStatus],
      deposit: {
        id: deposit.id,
        fundingTxHash: deposit.fundingTxHash,
        owner: deposit.owner,
        dates: deposit.dates,
      },
    },
    deposit.chainName,
  );
};

/**
 * Log deposit creation
 */
export const logDepositCreated = async (deposit: Deposit): Promise<void> => {
  await appendToAuditLog(
    AuditEventType.DEPOSIT_CREATED,
    deposit.id,
    {
      deposit: {
        id: deposit.id,
        fundingTxHash: deposit.fundingTxHash,
        owner: deposit.owner,
        l2DepositOwner: deposit.L1OutputEvent?.l2DepositOwner,
        status: 'QUEUED',
        createdAt: deposit.dates.createdAt,
      },
    },
    deposit.chainName,
  );
};

/**
 * Log deposit initialization
 */
export const logDepositInitialized = async (deposit: Deposit): Promise<void> => {
  await appendToAuditLog(
    AuditEventType.DEPOSIT_INITIALIZED,
    deposit.id,
    {
      deposit: {
        id: deposit.id,
        fundingTxHash: deposit.fundingTxHash,
        owner: deposit.owner,
        l2DepositOwner: deposit.L1OutputEvent?.l2DepositOwner,
        status: 'INITIALIZED',
        initializedAt: deposit.dates.initializationAt,
      },
      txHash: deposit.hashes.eth.initializeTxHash,
    },
    deposit.chainName,
  );
};

/**
 * Log deposit finalization
 */
export const logDepositFinalized = async (deposit: Deposit): Promise<void> => {
  await appendToAuditLog(
    AuditEventType.DEPOSIT_FINALIZED,
    deposit.id,
    {
      deposit: {
        id: deposit.id,
        fundingTxHash: deposit.fundingTxHash,
        owner: deposit.owner,
        l2DepositOwner: deposit.L1OutputEvent?.l2DepositOwner,
        status: 'FINALIZED',
        finalizedAt: deposit.dates.finalizationAt,
      },
      txHash: deposit.hashes.eth.finalizeTxHash,
    },
    deposit.chainName,
  );
};

/**
 * Log deposit deletion
 */
export const logDepositDeleted = async (deposit: Deposit, reason: string): Promise<void> => {
  await appendToAuditLog(
    AuditEventType.DEPOSIT_DELETED,
    deposit.id,
    {
      deposit: {
        id: deposit.id,
        fundingTxHash: deposit.fundingTxHash,
        owner: deposit.owner,
        l2DepositOwner: deposit.L1OutputEvent?.l2DepositOwner,
        status: deposit.status,
        createdAt: deposit.dates.createdAt,
        initializedAt: deposit.dates.initializationAt,
        finalizedAt: deposit.dates.finalizationAt,
      },
      reason,
    },
    deposit.chainName,
  );
};

/**
 * Log API requests related to deposits
 */
export const logApiRequest = async (
  endpoint: string,
  method: string,
  depositId: string | null,
  requestData: any = {},
  responseStatus: number = 200,
  chainName?: string,
): Promise<void> => {
  await appendToAuditLog(
    AuditEventType.API_REQUEST,
    depositId || 'no-deposit-id',
    {
      endpoint,
      method,
      requestData,
      responseStatus,
    },
    chainName,
  );
};

/**
 * Log errors related to deposits
 */
export const logDepositError = async (
  depositId: string,
  message: string,
  extra?: any,
  chainName?: string,
): Promise<void> => {
  const data = { message, ...(extra || {}) };
  await appendToAuditLog(AuditEventType.ERROR, depositId, data, chainName);
};

/**
 * Log deposit finalization
 * @param deposit The deposit object
 */
export const logDepositAwaitingWormholeVAA = (deposit: Deposit): void => {
  appendToAuditLog(
    AuditEventType.DEPOSIT_AWAITING_WORMHOLE_VAA,
    deposit.id,
    {
      deposit: {
        id: deposit.id,
        fundingTxHash: deposit.fundingTxHash,
        owner: deposit.owner,
        l2DepositOwner: deposit.L1OutputEvent?.l2DepositOwner,
        status: 'AWAITING_WORMHOLE_VAA',
        awaitingWormholeVAAMessageSince: deposit.dates.awaitingWormholeVAAMessageSince,
      },
      txHash: deposit.hashes.eth.finalizeTxHash,
    },
    deposit.chainName,
  );
};

/**
 * Log deposit finalization
 * @param deposit The deposit object
 */
export const logDepositBridged = (deposit: Deposit): void => {
  appendToAuditLog(
    AuditEventType.DEPOSIT_BRIDGED,
    deposit.id,
    {
      deposit: {
        id: deposit.id,
        fundingTxHash: deposit.fundingTxHash,
        owner: deposit.owner,
        l2DepositOwner: deposit.L1OutputEvent?.l2DepositOwner,
        status: 'BRIDGED',
        bridgedAt: deposit.dates.bridgedAt,
      },
      txHash: deposit.hashes.solana.bridgeTxHash,
    },
    deposit.chainName,
  );
};
