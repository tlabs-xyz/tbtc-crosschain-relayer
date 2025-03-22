import fs from 'fs';
import path from 'path';
import { DepositStatus } from '../types/DepositStatus.enum';
import { Deposit } from '../types/Deposit.type';
import { LogError, LogMessage } from './Logs';

// Constants
const AUDIT_LOG_DIR = process.env.AUDIT_LOG_DIR || "./logs";
const AUDIT_LOG_FILE = process.env.AUDIT_LOG_FILE || "deposit_audit.log";
const AUDIT_LOG_PATH = path.join(AUDIT_LOG_DIR, AUDIT_LOG_FILE);

// Event types
export enum AuditEventType {
  DEPOSIT_CREATED = "DEPOSIT_CREATED",
  DEPOSIT_UPDATED = "DEPOSIT_UPDATED",
  STATUS_CHANGED = "STATUS_CHANGED",
  DEPOSIT_INITIALIZED = "DEPOSIT_INITIALIZED", 
  DEPOSIT_FINALIZED = "DEPOSIT_FINALIZED",
  DEPOSIT_DELETED = "DEPOSIT_DELETED",
  ERROR = "ERROR",
  API_REQUEST = "API_REQUEST"
}

// Initialize the audit log directory
export const initializeAuditLog = (): void => {
  try {
    if (!fs.existsSync(AUDIT_LOG_DIR)) {
      fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true });
      LogMessage(`Created audit log directory: ${AUDIT_LOG_DIR}`);
    }
    
    // Create the log file if it doesn't exist
    if (!fs.existsSync(AUDIT_LOG_PATH)) {
      fs.writeFileSync(AUDIT_LOG_PATH, '', 'utf8');
      LogMessage(`Created audit log file: ${AUDIT_LOG_PATH}`);
    }
  } catch (error) {
    LogError("Failed to initialize audit log", error as Error);
  }
};

/**
 * Append an event to the audit log
 * @param eventType Type of the event
 * @param depositId ID of the deposit
 * @param data Additional data to log
 */
export const appendToAuditLog = (
  eventType: AuditEventType,
  depositId: string,
  data: any = {}
): void => {
  try {
    // Create directory if it doesn't exist
    if (!fs.existsSync(AUDIT_LOG_DIR)) {
      initializeAuditLog();
    }
    
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      eventType,
      depositId,
      data
    };
    
    // Append to log file
    fs.appendFileSync(
      AUDIT_LOG_PATH, 
      JSON.stringify(logEntry) + '\n',
      'utf8'
    );
  } catch (error) {
    // Log to console as fallback if file logging fails
    LogError("Failed to write to audit log", error as Error);
    console.error("AUDIT LOG ENTRY (FALLBACK):", {
      timestamp: new Date().toISOString(),
      eventType,
      depositId,
      data
    });
  }
};

/**
 * Log status changes for a deposit
 * @param deposit The deposit object
 * @param oldStatus Previous status (optional)
 * @param newStatus New status
 */
export const logStatusChange = (
  deposit: Deposit,
  newStatus: DepositStatus,
  oldStatus?: DepositStatus
): void => {
  const statusMap = {
    [DepositStatus.QUEUED]: "QUEUED",
    [DepositStatus.INITIALIZED]: "INITIALIZED",
    [DepositStatus.FINALIZED]: "FINALIZED"
  };
  
  appendToAuditLog(
    AuditEventType.STATUS_CHANGED,
    deposit.id,
    {
      from: oldStatus !== undefined ? statusMap[oldStatus] : "UNKNOWN",
      to: statusMap[newStatus],
      deposit: {
        id: deposit.id,
        fundingTxHash: deposit.fundingTxHash,
        owner: deposit.owner,
        dates: deposit.dates
      }
    }
  );
};

/**
 * Log deposit creation
 * @param deposit The deposit object
 */
export const logDepositCreated = (deposit: Deposit): void => {
  appendToAuditLog(
    AuditEventType.DEPOSIT_CREATED,
    deposit.id,
    {
      deposit: {
        id: deposit.id,
        fundingTxHash: deposit.fundingTxHash,
        owner: deposit.owner,
        l2DepositOwner: deposit.L1OutputEvent?.l2DepositOwner,
        status: "QUEUED",
        createdAt: deposit.dates.createdAt
      }
    }
  );
};

/**
 * Log deposit initialization
 * @param deposit The deposit object
 */
export const logDepositInitialized = (deposit: Deposit): void => {
  appendToAuditLog(
    AuditEventType.DEPOSIT_INITIALIZED,
    deposit.id,
    {
      deposit: {
        id: deposit.id,
        fundingTxHash: deposit.fundingTxHash,
        owner: deposit.owner,
        l2DepositOwner: deposit.L1OutputEvent?.l2DepositOwner,
        status: "INITIALIZED",
        initializedAt: deposit.dates.initializationAt
      },
      txHash: deposit.hashes.eth.initializeTxHash
    }
  );
};

/**
 * Log deposit finalization
 * @param deposit The deposit object
 */
export const logDepositFinalized = (deposit: Deposit): void => {
  appendToAuditLog(
    AuditEventType.DEPOSIT_FINALIZED,
    deposit.id,
    {
      deposit: {
        id: deposit.id,
        fundingTxHash: deposit.fundingTxHash,
        owner: deposit.owner,
        l2DepositOwner: deposit.L1OutputEvent?.l2DepositOwner,
        status: "FINALIZED",
        finalizedAt: deposit.dates.finalizationAt
      },
      txHash: deposit.hashes.eth.finalizeTxHash
    }
  );
};

/**
 * Log deposit deletion
 * @param deposit The deposit object
 * @param reason Reason for deletion
 */
export const logDepositDeleted = (deposit: Deposit, reason: string): void => {
  appendToAuditLog(
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
        finalizedAt: deposit.dates.finalizationAt
      },
      reason
    }
  );
};

/**
 * Log API requests related to deposits
 * @param endpoint API endpoint
 * @param method HTTP method
 * @param depositId Deposit ID (if applicable)
 * @param requestData Request data
 * @param responseStatus Response status code
 */
export const logApiRequest = (
  endpoint: string,
  method: string,
  depositId: string | null,
  requestData: any = {},
  responseStatus: number = 200
): void => {
  appendToAuditLog(
    AuditEventType.API_REQUEST,
    depositId || "no-deposit-id",
    {
      endpoint,
      method,
      requestData,
      responseStatus
    }
  );
};

/**
 * Log errors related to deposits
 * @param depositId Deposit ID
 * @param errorMessage Error message
 * @param errorObj Error object
 */
export const logDepositError = (
  depositId: string,
  errorMessage: string,
  errorObj: any = {}
): void => {
  appendToAuditLog(
    AuditEventType.ERROR,
    depositId,
    {
      message: errorMessage,
      error: errorObj.message || JSON.stringify(errorObj)
    }
  );
};