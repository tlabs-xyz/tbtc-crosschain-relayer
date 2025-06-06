// utils/AuditLog.ts - Audit log utility for deposit lifecycle and API events
//
// Provides functions and types for logging deposit events, status changes, errors, and API requests to the database audit log.

import { prisma } from './prisma.js';
import { DepositStatus } from '../types/DepositStatus.enum.js';
import type { Deposit } from '../types/Deposit.type.js';
import { logErrorContext } from './Logger.js';
import type { InputJsonValue } from '@prisma/client/runtime/library';

// =====================
// Event Types
// =====================

/**
 * Enum of all possible audit event types for deposit and API activity
 */
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

// =====================
// Type Definitions
// =====================

/**
 * Data for a deposit status change event
 */
export interface AuditLogStatusChangeData {
  from: string;
  to: string;
  deposit: {
    id: string;
    fundingTxHash: string;
    owner: string;
    dates: Deposit['dates'];
  };
}

/**
 * Data for deposit-related audit log events
 */
export interface AuditLogDepositData {
  deposit: {
    id: string;
    fundingTxHash: string;
    owner: string;
    l2DepositOwner?: string;
    status: string;
    createdAt?: Date;
    initializedAt?: Date;
    finalizedAt?: Date;
    awaitingWormholeVAAMessageSince?: Date;
    bridgedAt?: Date;
  };
  txHash?: string | null;
  reason?: string;
}

/**
 * Data for API request audit log events
 */
export interface AuditLogApiRequestData {
  endpoint: string;
  method: string;
  requestData: Record<string, unknown>;
  responseStatus: number;
}

/**
 * Data for error audit log events
 */
export interface AuditLogErrorData {
  message: string;
  [key: string]: unknown;
}

/**
 * Union type for all audit log data payloads
 */
export type AuditLogData =
  | AuditLogStatusChangeData
  | AuditLogDepositData
  | AuditLogApiRequestData
  | AuditLogErrorData
  | Record<string, unknown>;

// =====================
// Core Audit Logging Functions
// =====================

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
  data: AuditLogData,
  chainName?: string,
): Promise<void> => {
  let errorCode: number | undefined = undefined;
  let processedData = data;

  if (data && typeof data === 'object' && 'code' in data && typeof data.code === 'number') {
    errorCode = data.code;
    // Remove code from data to avoid duplication
    const { code: _, ...rest } = data;
    processedData = rest;
  }

  try {
    await prisma.auditLog.create({
      data: {
        eventType,
        depositId,
        data: processedData as InputJsonValue,
        errorCode,
        chainName,
      },
    });
  } catch (error) {
    // Audit logging is non-critical - log the error but don't throw
    // This prevents audit log failures from breaking the main application flow
    logErrorContext('Failed to create audit log entry', error);
  }
};

/**
 * Get all audit logs
 * @returns Array of audit log entries
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
 * @param depositId Deposit ID to filter logs
 * @returns Array of audit log entries for the deposit
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
 * Map DepositStatus to string for audit logging
 * @param status DepositStatus enum value
 * @returns String representation of the status
 */
function mapDepositStatusToString(status: DepositStatus | undefined): string {
  switch (status) {
    case DepositStatus.QUEUED:
      return 'QUEUED';
    case DepositStatus.INITIALIZED:
      return 'INITIALIZED';
    case DepositStatus.FINALIZED:
      return 'FINALIZED';
    case DepositStatus.AWAITING_WORMHOLE_VAA:
      return 'AWAITING_WORMHOLE_VAA';
    case DepositStatus.BRIDGED:
      return 'BRIDGED';
    case DepositStatus.ERROR_SENDING_L1_TX:
      return 'ERROR_SENDING_L1_TX';
    case DepositStatus.ERROR:
      return 'ERROR';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Log status changes for a deposit
 * @param deposit The deposit object
 * @param newStatus The new status
 * @param oldStatus The previous status
 */
export const logStatusChange = async (
  deposit: Deposit,
  newStatus: DepositStatus,
  oldStatus?: DepositStatus,
): Promise<void> => {
  await appendToAuditLog(
    AuditEventType.STATUS_CHANGED,
    deposit.id,
    {
      from: mapDepositStatusToString(oldStatus),
      to: mapDepositStatusToString(newStatus),
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
 * @param deposit The deposit object
 */
export const logDepositCreated = async (deposit: Deposit): Promise<void> => {
  const data: AuditLogDepositData = {
    deposit: {
      id: deposit.id,
      fundingTxHash: deposit.fundingTxHash,
      owner: deposit.owner,
      l2DepositOwner: deposit.L1OutputEvent?.l2DepositOwner,
      status: 'QUEUED',
      createdAt: deposit.dates.createdAt ? new Date(deposit.dates.createdAt) : undefined,
    },
  };

  await appendToAuditLog(AuditEventType.DEPOSIT_CREATED, deposit.id, data, deposit.chainName);
};

/**
 * Log deposit initialization
 * @param deposit The deposit object
 */
export const logDepositInitialized = async (deposit: Deposit): Promise<void> => {
  const data: AuditLogDepositData = {
    deposit: {
      id: deposit.id,
      fundingTxHash: deposit.fundingTxHash,
      owner: deposit.owner,
      l2DepositOwner: deposit.L1OutputEvent?.l2DepositOwner,
      status: 'INITIALIZED',
      initializedAt: deposit.dates.initializationAt
        ? new Date(deposit.dates.initializationAt)
        : undefined,
    },
    txHash: deposit.hashes.eth.initializeTxHash,
  };

  await appendToAuditLog(AuditEventType.DEPOSIT_INITIALIZED, deposit.id, data, deposit.chainName);
};

/**
 * Log deposit finalization
 * @param deposit The deposit object
 */
export const logDepositFinalized = async (deposit: Deposit): Promise<void> => {
  const data: AuditLogDepositData = {
    deposit: {
      id: deposit.id,
      fundingTxHash: deposit.fundingTxHash,
      owner: deposit.owner,
      l2DepositOwner: deposit.L1OutputEvent?.l2DepositOwner,
      status: 'FINALIZED',
      finalizedAt: deposit.dates.finalizationAt
        ? new Date(deposit.dates.finalizationAt)
        : undefined,
    },
    txHash: deposit.hashes.eth.finalizeTxHash,
  };

  await appendToAuditLog(AuditEventType.DEPOSIT_FINALIZED, deposit.id, data, deposit.chainName);
};

/**
 * Log deposit deletion
 * @param deposit The deposit object
 * @param reason Reason for deletion
 */
export const logDepositDeleted = async (deposit: Deposit, reason: string): Promise<void> => {
  const data: AuditLogDepositData = {
    deposit: {
      id: deposit.id,
      fundingTxHash: deposit.fundingTxHash,
      owner: deposit.owner,
      l2DepositOwner: deposit.L1OutputEvent?.l2DepositOwner,
      status: String(deposit.status),
      createdAt: deposit.dates.createdAt ? new Date(deposit.dates.createdAt) : undefined,
      initializedAt: deposit.dates.initializationAt
        ? new Date(deposit.dates.initializationAt)
        : undefined,
      finalizedAt: deposit.dates.finalizationAt
        ? new Date(deposit.dates.finalizationAt)
        : undefined,
    },
    reason,
  };

  await appendToAuditLog(AuditEventType.DEPOSIT_DELETED, deposit.id, data, deposit.chainName);
};

/**
 * Log API requests related to deposits
 * @param endpoint API endpoint
 * @param method HTTP method
 * @param depositId Deposit ID (nullable)
 * @param requestData Request payload
 * @param responseStatus HTTP response status
 * @param chainName Optional chain name
 */
export const logApiRequest = async (
  endpoint: string,
  method: string,
  depositId: string | null,
  requestData: Record<string, unknown> = {},
  responseStatus: number = 200,
  chainName?: string,
): Promise<void> => {
  const data: AuditLogApiRequestData = {
    endpoint,
    method,
    requestData,
    responseStatus,
  };

  await appendToAuditLog(AuditEventType.API_REQUEST, depositId || 'no-deposit-id', data, chainName);
};

/**
 * Log errors related to deposits
 * @param depositId Deposit ID
 * @param message Error message
 * @param extra Additional error data
 * @param chainName Optional chain name
 */
export const logDepositError = async (
  depositId: string,
  message: string,
  extra?: Record<string, unknown>,
  chainName?: string,
): Promise<void> => {
  const data: AuditLogErrorData = { message, ...(extra || {}) };
  await appendToAuditLog(AuditEventType.ERROR, depositId, data, chainName);
};

/**
 * Log deposit awaiting Wormhole VAA
 * @param deposit The deposit object
 */
export const logDepositAwaitingWormholeVAA = async (deposit: Deposit): Promise<void> => {
  const data: AuditLogDepositData = {
    deposit: {
      id: deposit.id,
      fundingTxHash: deposit.fundingTxHash,
      owner: deposit.owner,
      l2DepositOwner: deposit.L1OutputEvent?.l2DepositOwner,
      status: 'AWAITING_WORMHOLE_VAA',
      awaitingWormholeVAAMessageSince: deposit.dates.awaitingWormholeVAAMessageSince
        ? new Date(deposit.dates.awaitingWormholeVAAMessageSince)
        : undefined,
    },
    txHash: deposit.hashes.eth.finalizeTxHash ?? undefined,
  };

  await appendToAuditLog(
    AuditEventType.DEPOSIT_AWAITING_WORMHOLE_VAA,
    deposit.id,
    data,
    deposit.chainName,
  );
};

/**
 * Log deposit bridged
 * @param deposit The deposit object
 */
export const logDepositBridged = async (deposit: Deposit): Promise<void> => {
  const data: AuditLogDepositData = {
    deposit: {
      id: deposit.id,
      fundingTxHash: deposit.fundingTxHash,
      owner: deposit.owner,
      l2DepositOwner: deposit.L1OutputEvent?.l2DepositOwner,
      status: 'BRIDGED',
      bridgedAt: deposit.dates.bridgedAt ? new Date(deposit.dates.bridgedAt) : undefined,
    },
    txHash: deposit.hashes.solana.bridgeTxHash ?? undefined,
  };

  await appendToAuditLog(AuditEventType.DEPOSIT_BRIDGED, deposit.id, data, deposit.chainName);
};

// =====================
// Audit Log Utilities
// =====================

/**
 * Write an audit log entry to the specified log file.
 * @param message The log message
 * @param level The log level (e.g., 'info', 'error')
 */
