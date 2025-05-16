import path from 'path';
import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { DepositStatus as DepositStatusEnum } from '../../../types/DepositStatus.enum.js';
import { Deposit } from '../../../types/Deposit.type.js';

import { AuditEventType } from '../../../utils/AuditLog.js';

// Initialize logger mocks at the TOP LEVEL
const mockLoggerError = jest.fn();
const mockLoggerInfo = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerDebug = jest.fn();
const mockLogErrorContext = jest.fn();

// Mock Logger.js (uses top-level initialized mocks)
jest.mock('../../../utils/Logger.js', () => ({
  __esModule: true,
  default: {
    info: mockLoggerInfo,
    error: mockLoggerError,
    warn: mockLoggerWarn,
    debug: mockLoggerDebug,
  },
  logErrorContext: mockLogErrorContext,
}));

// Initialize fs mock functions at the TOP LEVEL
const mockExistsSyncFn = jest.fn();
const mockMkdirSyncFn = jest.fn();
const mockWriteFileSyncFn = jest.fn();
const mockAppendFileSyncFn = jest.fn();

// Mock the fs module
jest.mock('fs', () => ({
  __esModule: true,
  existsSync: mockExistsSyncFn,
  mkdirSync: mockMkdirSyncFn,
  writeFileSync: mockWriteFileSyncFn,
  appendFileSync: mockAppendFileSyncFn,
  default: {
    existsSync: mockExistsSyncFn,
    mkdirSync: mockMkdirSyncFn,
    writeFileSync: mockWriteFileSyncFn,
    appendFileSync: mockAppendFileSyncFn,
  },
}));

let mockMkdirSync: jest.Mock;
let mockWriteFileSync: jest.Mock;
let mockAppendFileSync: jest.Mock;
let mockExistsSync: jest.Mock;

describe('AuditLog', () => {
  let AuditLogModule: typeof import('../../../utils/AuditLog');

  process.env.AUDIT_LOG_DIR = './tests/logs/audit_specific'; // Ensure unique path
  process.env.AUDIT_LOG_FILE = 'audit_module_test.log';
  const testAuditLogDir = path.resolve(process.env.AUDIT_LOG_DIR);
  const testAuditLogFile = path.resolve(testAuditLogDir, process.env.AUDIT_LOG_FILE);

  beforeEach(() => {
    jest.resetModules();

    // Reset call counts for all top-level mocks
    mockLoggerInfo.mockReset();
    mockLoggerError.mockReset();
    mockLoggerWarn.mockReset();
    mockLoggerDebug.mockReset();
    mockLogErrorContext.mockReset();

    mockExistsSyncFn.mockReset();
    mockMkdirSyncFn.mockReset();
    mockWriteFileSyncFn.mockReset();
    mockAppendFileSyncFn.mockReset();

    // Now require the module under test AFTER mocks are set up and reset
    AuditLogModule = require('../../../utils/AuditLog');

    // Default behavior for existsSync for most tests
    mockExistsSyncFn.mockImplementation((p) => {
      if (p === testAuditLogDir) return true;
      if (p === testAuditLogFile) return true;
      return false;
    });

    mockExistsSync = mockExistsSyncFn;
    mockMkdirSync = mockMkdirSyncFn;
    mockWriteFileSync = mockWriteFileSyncFn;
    mockAppendFileSync = mockAppendFileSyncFn;

    mockLoggerError.mockClear();
    mockLoggerInfo.mockClear();
    mockLoggerWarn.mockClear();
    mockLoggerDebug.mockClear();
    mockLogErrorContext.mockClear();
    mockExistsSync.mockClear();
    mockMkdirSync.mockClear();
    mockWriteFileSync.mockClear();
    mockAppendFileSync.mockClear();
  });

  describe('initializeAuditLog', () => {
    test('should create directory and file if they do not exist', () => {
      mockExistsSyncFn.mockReset(); // Clear previous default
      mockExistsSyncFn
        .mockReturnValueOnce(false) // dir does not exist
        .mockReturnValueOnce(false); // file does not exist
      AuditLogModule.initializeAuditLog();
      expect(mockMkdirSyncFn).toHaveBeenCalledWith(testAuditLogDir, { recursive: true });
      expect(mockWriteFileSyncFn).toHaveBeenCalledWith(testAuditLogFile, '', 'utf8');
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        `Created audit log directory: ${testAuditLogDir}`,
      );
      expect(mockLoggerInfo).toHaveBeenCalledWith(`Created audit log file: ${testAuditLogFile}`);
    });

    test('should only create file if directory exists but file does not', () => {
      mockExistsSyncFn.mockReset();
      mockExistsSyncFn
        .mockReturnValueOnce(true) // dir exists
        .mockReturnValueOnce(false); // file does not exist
      AuditLogModule.initializeAuditLog();
      expect(mockMkdirSyncFn).not.toHaveBeenCalled();
      expect(mockWriteFileSyncFn).toHaveBeenCalledWith(testAuditLogFile, '', 'utf8');
      expect(mockLoggerInfo).toHaveBeenCalledWith(`Created audit log file: ${testAuditLogFile}`);
    });

    test('should do nothing if directory and file already exist', () => {
      mockExistsSyncFn.mockReset();
      mockExistsSyncFn.mockReturnValue(true); // Both exist
      AuditLogModule.initializeAuditLog();
      expect(mockMkdirSyncFn).not.toHaveBeenCalled();
      expect(mockWriteFileSyncFn).not.toHaveBeenCalled();
      expect(mockLoggerInfo).not.toHaveBeenCalled();
    });

    test('should call logErrorContext if fs.mkdirSync fails', () => {
      mockExistsSyncFn.mockReset();
      mockExistsSyncFn.mockReturnValue(false); // dir does not exist
      const mkdirError = new Error('mkdir failed');
      mockMkdirSyncFn.mockImplementation(() => {
        throw mkdirError;
      });
      AuditLogModule.initializeAuditLog();
      expect(mockLogErrorContext).toHaveBeenCalledWith(
        'Failed to initialize audit log',
        mkdirError,
      );
    });

    test('should call logErrorContext if fs.writeFileSync fails for new file', () => {
      mockExistsSyncFn.mockReset();
      mockExistsSyncFn.mockReturnValueOnce(false).mockReturnValueOnce(false); // dir & file don't exist
      const writeFileError = new Error('writeFileSync failed for new file');
      // Let mkdirSync succeed but writeFileSync fail
      mockMkdirSyncFn.mockImplementation(() => {}); // Simulates successful dir creation
      mockWriteFileSyncFn.mockImplementation(() => {
        throw writeFileError;
      });
      AuditLogModule.initializeAuditLog();
      expect(mockLogErrorContext).toHaveBeenCalledWith(
        'Failed to initialize audit log',
        writeFileError,
      );
    });
  });

  describe('appendToAuditLog', () => {
    const testDepositId = 'test-deposit-123';
    const testData = { info: 'test data' };

    test('should append entry to audit log file if dir and file exist', () => {
      mockExistsSyncFn.mockReturnValue(true); // Ensure dir and file are mocked to exist
      AuditLogModule.appendToAuditLog(AuditEventType.DEPOSIT_CREATED, testDepositId, testData);
      expect(mockAppendFileSyncFn).toHaveBeenCalledTimes(1);
      expect(mockAppendFileSyncFn).toHaveBeenCalledWith(
        testAuditLogFile,
        expect.stringContaining(testDepositId),
        'utf8',
      );
    });

    test('should create file and append if directory exists but file does not', () => {
      mockExistsSyncFn.mockReset();
      mockExistsSyncFn
        .mockImplementationOnce((p) => p === testAuditLogDir) // Dir exists
        .mockImplementationOnce((p) => p !== testAuditLogFile); // File does not exist for path check
      AuditLogModule.appendToAuditLog(AuditEventType.DEPOSIT_UPDATED, testDepositId, {
        status: 'new_status',
      });
      expect(mockWriteFileSyncFn).toHaveBeenCalledWith(testAuditLogFile, '', 'utf8'); // File created first
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        `Audit log file was missing, recreated: ${testAuditLogFile}`,
      );
      expect(mockAppendFileSyncFn).toHaveBeenCalledTimes(1); // Then entry appended
    });

    test('should call logErrorContext and console.error if directory does not exist', () => {
      mockExistsSyncFn.mockReset();
      mockExistsSyncFn.mockImplementation((p) => p !== testAuditLogDir); // testAuditLogDir will return false
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      AuditLogModule.appendToAuditLog(AuditEventType.ERROR, 'error-deposit-id', {
        message: 'critical failure',
      });
      expect(mockLogErrorContext).toHaveBeenCalledWith(
        'Failed to write to audit log',
        expect.objectContaining({
          message: `Audit log directory does not exist: ${testAuditLogDir}`,
        }),
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'AUDIT LOG ENTRY (FALLBACK):',
        expect.objectContaining({ eventType: AuditEventType.ERROR, depositId: 'error-deposit-id' }),
      );
      consoleErrorSpy.mockRestore();
    });

    test('should call logErrorContext and console.error if appendFileSync fails', () => {
      mockExistsSyncFn.mockReturnValue(true); // Dir and file exist
      const appendError = new Error('appendFileSync failed miserably');
      mockAppendFileSyncFn.mockImplementation(() => {
        throw appendError;
      });
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      AuditLogModule.appendToAuditLog(AuditEventType.DEPOSIT_FINALIZED, testDepositId, {
        info: 'final data',
      });
      expect(mockLogErrorContext).toHaveBeenCalledWith('Failed to write to audit log', appendError);
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('Event-specific log functions', () => {
    const testEvtDepositFull = {
      id: 'evt-deposit-id',
      fundingTxHash: '0xfundingtxhash_event_specific',
      outputIndex: 0, // Assuming this might be needed by some internal logic or full Deposit type
      hashes: {
        btc: { btcTxHash: '0xbtchash_event_specific' },
        eth: {
          initializeTxHash: '0xinitHash_event_specific',
          finalizeTxHash: '0xfinalHash_event_specific',
        },
      },
      receipt: {
        // Add a minimal receipt structure
        depositor: '0xdepositor_event',
        blindingFactor: '0xblinding_event',
        walletPublicKeyHash: '0xwalletpubkey_event',
        refundPublicKeyHash: '0xrefundpubkey_event',
        refundLocktime: '0xlocktime_event',
        extraData: '0xextra_event',
      },
      owner: '0xowner_event_specific',
      status: 0, // DepositStatus.QUEUED
      L1OutputEvent: {
        fundingTx: {
          version: '0x1',
          inputVector: '0xin',
          outputVector: '0xout',
          locktime: '0xlt',
        },
        reveal: [1, '0xbr', '0xwr', '0xrr', '0xlr', '0xer'],
        l2DepositOwner: '0xl2owner_event_specific',
        l2Sender: '0xl2sender_event_specific',
      },
      dates: {
        createdAt: new Date('2023-01-01T10:00:00.000Z').getTime(),
        initializationAt: null,
        finalizationAt: null,
        lastActivityAt: new Date('2023-01-01T10:00:00.000Z').getTime(),
      },
      error: null,
    } as Deposit; // Use the actual Deposit type for better safety, will require all fields.

    let appendToAuditLogSpy: any;

    beforeEach(() => {
      appendToAuditLogSpy = jest.spyOn(AuditLogModule, 'appendToAuditLog');
    });

    afterEach(() => {
      appendToAuditLogSpy.mockRestore();
    });

    test('logDepositCreated should call appendToAuditLog with correct event type and data', () => {
      AuditLogModule.logDepositCreated(testEvtDepositFull);
      expect(appendToAuditLogSpy).toHaveBeenCalledWith(
        AuditEventType.DEPOSIT_CREATED,
        testEvtDepositFull.id,
        expect.objectContaining({
          deposit: expect.objectContaining({
            id: testEvtDepositFull.id,
            createdAt: testEvtDepositFull.dates.createdAt,
          }),
        }),
      );
    });

    test('logStatusChange should call appendToAuditLog with correct event type and data', () => {
      AuditLogModule.logStatusChange(
        testEvtDepositFull,
        DepositStatusEnum.INITIALIZED,
        DepositStatusEnum.QUEUED,
      );
      expect(appendToAuditLogSpy).toHaveBeenCalledWith(
        AuditEventType.STATUS_CHANGED,
        testEvtDepositFull.id,
        expect.objectContaining({
          from: 'QUEUED', // Or what the statusMap would produce for DepositStatusEnum.QUEUED
          to: 'INITIALIZED', // Or what the statusMap would produce for DepositStatusEnum.INITIALIZED
          deposit: expect.objectContaining({ id: testEvtDepositFull.id }),
        }),
      );
    });

    test('logDepositInitialized should call appendToAuditLog with correct event type and data', () => {
      const initTestDeposit = {
        ...testEvtDepositFull,
        dates: {
          ...testEvtDepositFull.dates,
          initializationAt: new Date('2023-01-01T11:00:00.000Z').getTime(),
        },
        hashes: {
          ...testEvtDepositFull.hashes,
          eth: { ...testEvtDepositFull.hashes.eth, initializeTxHash: '0xrealInitHash' },
        },
      };
      AuditLogModule.logDepositInitialized(initTestDeposit);
      expect(appendToAuditLogSpy).toHaveBeenCalledWith(
        AuditEventType.DEPOSIT_INITIALIZED,
        initTestDeposit.id,
        expect.objectContaining({
          deposit: expect.objectContaining({
            id: initTestDeposit.id,
            initializedAt: initTestDeposit.dates.initializationAt,
          }),
          txHash: '0xrealInitHash',
        }),
      );
    });

    test('logDepositFinalized should call appendToAuditLog with correct event type and data', () => {
      const finalTestDeposit = {
        ...testEvtDepositFull,
        dates: {
          ...testEvtDepositFull.dates,
          finalizationAt: new Date('2023-01-01T12:00:00.000Z').getTime(),
        },
        hashes: {
          ...testEvtDepositFull.hashes,
          eth: { ...testEvtDepositFull.hashes.eth, finalizeTxHash: '0xrealFinalHash' },
        },
      };
      AuditLogModule.logDepositFinalized(finalTestDeposit);
      expect(appendToAuditLogSpy).toHaveBeenCalledWith(
        AuditEventType.DEPOSIT_FINALIZED,
        finalTestDeposit.id,
        expect.objectContaining({
          deposit: expect.objectContaining({
            id: finalTestDeposit.id,
            finalizedAt: finalTestDeposit.dates.finalizationAt,
          }),
          txHash: '0xrealFinalHash',
        }),
      );
    });

    test('logDepositDeleted should call appendToAuditLog with correct event type and data', () => {
      const reason = 'test reason for deletion';
      AuditLogModule.logDepositDeleted(testEvtDepositFull, reason);
      expect(appendToAuditLogSpy).toHaveBeenCalledWith(
        AuditEventType.DEPOSIT_DELETED,
        testEvtDepositFull.id,
        expect.objectContaining({
          reason,
          deposit: expect.objectContaining({ id: testEvtDepositFull.id }),
        }),
      );
    });

    test('logApiRequest should call appendToAuditLog with correct event type and data', () => {
      AuditLogModule.logApiRequest(
        '/api/test',
        'POST',
        testEvtDepositFull.id,
        { test: 'payload' },
        201,
      );
      expect(appendToAuditLogSpy).toHaveBeenCalledWith(
        AuditEventType.API_REQUEST,
        testEvtDepositFull.id,
        expect.any(Object),
      );
    });

    test('logDepositError should call appendToAuditLog with correct event type and data', () => {
      const errMsg = 'A test error occurred';
      AuditLogModule.logDepositError(testEvtDepositFull.id, errMsg, { code: 500 });
      expect(appendToAuditLogSpy).toHaveBeenCalledWith(
        AuditEventType.ERROR,
        testEvtDepositFull.id,
        expect.objectContaining({ message: errMsg }),
      );
    });
  });
});
