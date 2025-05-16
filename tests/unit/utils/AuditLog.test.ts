import path from 'path';
import { DepositStatus } from '../../../types/DepositStatus.enum';
import { createTestDeposit } from '../../mocks/BlockchainMock';
import {
  describe,
  test,
  expect,
  beforeEach,
  jest,
} from '@jest/globals';

// --- Type Aliases for AuditLog functions (optional but helpful) ---
type AuditLogFunctions = typeof import('../../../utils/AuditLog');
let initializeAuditLog: AuditLogFunctions['initializeAuditLog'];
let appendToAuditLog: AuditLogFunctions['appendToAuditLog'];
let logDepositCreated: AuditLogFunctions['logDepositCreated'];
let logDepositInitialized: AuditLogFunctions['logDepositInitialized'];
let logDepositFinalized: AuditLogFunctions['logDepositFinalized'];
let logDepositDeleted: AuditLogFunctions['logDepositDeleted'];
let logStatusChange: AuditLogFunctions['logStatusChange'];
let AuditEventType: AuditLogFunctions['AuditEventType'];

// --- Type Alias for Logs functions ---
type LogsFunctions = typeof import('../../../utils/Logs');
let mockLogError: jest.Mock; // Mock function for LogError

// Set test environment variables
process.env.AUDIT_LOG_DIR = './tests/logs';
process.env.AUDIT_LOG_FILE = 'test-audit.log';
const TEST_LOG_DIR = path.resolve('./tests/logs');
const TEST_LOG_FILE = path.resolve(TEST_LOG_DIR, 'test-audit.log');

// --- Mock the 'fs' module ---
// jest.mock('fs');

// --- Mock the 'utils/Logs' module ---
jest.mock('../../../utils/Logs', () => ({
  LogError: jest.fn(),
  LogMessage: jest.fn(),
  LogInfo: jest.fn(),
  LogWarn: jest.fn(),
  LogDebug: jest.fn(),
  formatLog: jest.fn((msg) => msg),
}));

// --- Keep track of mocked file content ---
let mockFileContent = '';
let mockDirExists = false;
let mockFileExists = false;

// --- Define mock functions outside beforeEach for reference ---
// --- We will define mocks inline within jest.doMock ---
// --- Need variables to hold references to the inline mocks for assertions ---
let mockMkdirSync: jest.Mock;
let mockWriteFileSync: jest.Mock;
let mockAppendFileSync: jest.Mock;
let mockExistsSync: jest.Mock;
let mockLogMessage: jest.Mock;

describe('AuditLog', () => {
  beforeEach(() => {
    // --- Reset modules FIRST ---
    jest.resetModules();

    // --- Reset mock state variables ---
    mockFileContent = '';
    mockDirExists = false;
    mockFileExists = false;

    // --- Clear any previous mock references ---
    // (These will be reassigned in jest.doMock)
    mockExistsSync = jest.fn();
    mockMkdirSync = jest.fn();
    mockWriteFileSync = jest.fn();
    mockAppendFileSync = jest.fn();

    // --- Use jest.doMock for 'fs' JUST BEFORE require ---
    jest.doMock('fs', () => {
      // Define mocks inline
      const inlineExistsSync = jest.fn((p) => {
        const pathStr = String(p);
        let result: boolean;
        if (pathStr === TEST_LOG_DIR) {
          result = mockDirExists;
          console.log(
            `[inlineExistsSync] Check DIR: "${pathStr}", State: ${mockDirExists}, Returning: ${result}`
          );
        } else if (pathStr === TEST_LOG_FILE) {
          result = mockFileExists;
          console.log(
            `[inlineExistsSync] Check FILE: "${pathStr}", State: ${mockFileExists}, Returning: ${result}`
          );
        } else {
          result = false;
          console.log(
            `[inlineExistsSync] Check OTHER: "${pathStr}", Returning: ${result}`
          );
        }
        return result;
      });

      const inlineMkdirSync = jest.fn((p) => {
        console.log(`[inlineMkdirSync] Called with path: "${p}"`);
        if (p === TEST_LOG_DIR) {
          mockDirExists = true;
        }
      });

      const inlineWriteFileSync = jest.fn((p, data) => {
        console.log(`[inlineWriteFileSync] Called with path: "${p}"`);
        if (p === TEST_LOG_FILE) {
          mockFileExists = true;
          mockDirExists = true;
          mockFileContent = data as string;
        }
      });

      const inlineAppendFileSync = jest.fn((p, data) => {
        console.log(`[inlineAppendFileSync] Called with path: "${p}"`);
        if (p === TEST_LOG_FILE) {
          if (!mockFileExists) {
            mockFileExists = true;
            mockDirExists = true;
            mockFileContent = data as string;
          } else {
            mockFileContent += data as string;
          }
        }
      });

      // Assign inline mocks to outer variables for assertion access
      mockExistsSync = inlineExistsSync;
      mockMkdirSync = inlineMkdirSync;
      mockWriteFileSync = inlineWriteFileSync;
      mockAppendFileSync = inlineAppendFileSync;

      // Return the mocked module structure
      return {
        existsSync: inlineExistsSync,
        mkdirSync: inlineMkdirSync,
        writeFileSync: inlineWriteFileSync,
        appendFileSync: inlineAppendFileSync,
        // constants: jest.requireActual('fs').constants, // Keep if needed
      };
    });

    // --- Re-require the modules AFTER reset and doMock ---
    const AuditLogModule =
      require('../../../utils/AuditLog') as AuditLogFunctions;
    initializeAuditLog = AuditLogModule.initializeAuditLog;
    appendToAuditLog = AuditLogModule.appendToAuditLog;
    logDepositCreated = AuditLogModule.logDepositCreated;
    logDepositInitialized = AuditLogModule.logDepositInitialized;
    logDepositFinalized = AuditLogModule.logDepositFinalized;
    logDepositDeleted = AuditLogModule.logDepositDeleted;
    logStatusChange = AuditLogModule.logStatusChange;
    AuditEventType = AuditLogModule.AuditEventType; // Re-assign enum if needed

    const LogsModule = require('../../../utils/Logs') as LogsFunctions;
    // Assign the mock function from the mocked module
    mockLogError = LogsModule.LogError as jest.Mock;
    mockLogMessage = LogsModule.LogMessage as jest.Mock;

    // No need to clear mocks here, jest.fn() inside doMock creates fresh ones
    mockLogError.mockClear(); // Clear the LogError mock
    mockLogMessage.mockClear(); // Clear the LogMessage mock

    // Reset simulated file system state
    mockFileContent = '';
    mockDirExists = false;
    mockFileExists = false;
  });

  // No afterEach needed for cleanup when mocking fs

  describe('initializeAuditLog', () => {
    test('should create directory and file if they do not exist', () => {
      // Arrange: Set state variables to simulate non-existence
      console.log(
        '[Test Init 1] Setting mockDirExists=false, mockFileExists=false'
      );
      mockDirExists = false;
      mockFileExists = false;

      // Act
      console.log('[Test Init 1] Calling initializeAuditLog...');
      initializeAuditLog();
      console.log('[Test Init 1] initializeAuditLog finished.');

      // Assert: Check if fs functions were called correctly
      console.log('[Test Init 1] Asserting calls...');
      expect(mockMkdirSync).toHaveBeenCalledWith(TEST_LOG_DIR, {
        recursive: true,
      });
      expect(mockLogMessage).toHaveBeenCalledWith(
        `Created audit log directory: ${TEST_LOG_DIR}`
      );
      expect(mockWriteFileSync).toHaveBeenCalledWith(TEST_LOG_FILE, '', 'utf8');
      expect(mockLogMessage).toHaveBeenCalledWith(
        `Created audit log file: ${TEST_LOG_FILE}`
      );
    });

    test('should only create file if directory exists but file does not', () => {
      // Arrange: Set state variables
      console.log(
        '[Test Init 2] Setting mockDirExists=true, mockFileExists=false'
      );
      mockDirExists = true;
      mockFileExists = false;

      // Act
      console.log('[Test Init 2] Calling initializeAuditLog...');
      initializeAuditLog();
      console.log('[Test Init 2] initializeAuditLog finished.');

      // Assert
      console.log('[Test Init 2] Asserting calls...');
      expect(mockMkdirSync).not.toHaveBeenCalled();
      expect(mockWriteFileSync).toHaveBeenCalledWith(TEST_LOG_FILE, '', 'utf8');
      expect(mockLogMessage).toHaveBeenCalledWith(
        `Created audit log file: ${TEST_LOG_FILE}`
      );
    });

    test('should do nothing if directory and file already exist', () => {
      // Arrange: Set state variables
      console.log(
        '[Test Init 3] Setting mockDirExists=true, mockFileExists=true'
      );
      mockDirExists = true;
      mockFileExists = true;

      // Act
      console.log('[Test Init 3] Calling initializeAuditLog...');
      initializeAuditLog();
      console.log('[Test Init 3] initializeAuditLog finished.');

      // Assert
      console.log('[Test Init 3] Asserting calls...');
      expect(mockMkdirSync).not.toHaveBeenCalled();
      expect(mockWriteFileSync).not.toHaveBeenCalled();
      expect(mockLogMessage).not.toHaveBeenCalled();
    });
  });

  describe('appendToAuditLog', () => {
    test('should append entry to audit log file', () => {
      // Arrange: Set state variables
      mockDirExists = true;
      mockFileExists = true;
      // Initialize mock content if needed for append simulation
      mockFileContent = 'Existing content\n';

      const testEvent = AuditEventType.DEPOSIT_CREATED;
      const testDepositId = 'test-deposit-id';
      const testData = { testKey: 'testValue' };

      // Act
      appendToAuditLog(testEvent, testDepositId, testData);

      // Assert
      expect(mockAppendFileSync).toHaveBeenCalledTimes(1);
      const [filePath, fileData, encoding] = mockAppendFileSync.mock.calls[0];

      expect(filePath).toBe(TEST_LOG_FILE);
      expect(encoding).toBe('utf8');

      const appendedEntry = JSON.parse((fileData as string).trim());
      expect(appendedEntry.eventType).toBe(testEvent);
      expect(appendedEntry.depositId).toBe(testDepositId);
      expect(appendedEntry.data).toEqual(testData);
      expect(appendedEntry.timestamp).toBeDefined();

      // Optional: Check final mock content
      // expect(mockFileContent).toContain('Existing content');
      // expect(mockFileContent).toContain('"eventType":"DEPOSIT_CREATED"');
    });

    test('should create file if appending and file does not exist', () => {
      // Arrange: Set state variables
      mockDirExists = true;
      mockFileExists = false;

      // Act
      appendToAuditLog(AuditEventType.ERROR, 'err-id', { msg: 'Test' });

      // Assert: writeFileSync should be called by appendToAuditLog's internal check
      expect(mockWriteFileSync).toHaveBeenCalledWith(TEST_LOG_FILE, '', 'utf8');
      expect(mockLogMessage).toHaveBeenCalledWith(
        `Audit log file was missing, recreated: ${TEST_LOG_FILE}`
      );
      // Assert: appendFileSync should still be called AFTER writeFileSync
      expect(mockAppendFileSync).toHaveBeenCalledTimes(1);
      const [filePath, fileData] = mockAppendFileSync.mock.calls[0];
      expect(filePath).toBe(TEST_LOG_FILE);
      expect(JSON.parse((fileData as string).trim()).eventType).toBe(
        AuditEventType.ERROR
      );
    });

    // --- MODIFIED TEST ---
    test('should call LogError if directory does not exist', () => {
      // Arrange: Set state variables
      console.log(
        '[Test Append Error] Setting mockDirExists=false, mockFileExists=false'
      );
      mockDirExists = false;
      mockFileExists = false;

      // Act
      console.log('[Test Append Error] Calling appendToAuditLog...');
      appendToAuditLog(AuditEventType.ERROR, 'err-id', {});
      console.log('[Test Append Error] appendToAuditLog finished.');

      // Assert: Check that LogError was called instead of expecting a throw
      console.log('[Test Append Error] Asserting mockLogError call...');
      expect(mockLogError).toHaveBeenCalledTimes(1);
      expect(mockLogError).toHaveBeenCalledWith(
        'Failed to write to audit log',
        expect.any(Error) // Check that an Error object was passed
      );
      // Check that the error message is correct
      const actualError = mockLogError.mock.calls[0][1] as Error;
      expect(actualError.message).toBe(
        `Audit log directory does not exist: ${TEST_LOG_DIR}`
      );

      // Assert that file operations were NOT attempted
      expect(mockAppendFileSync).not.toHaveBeenCalled();
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });
  });

  // --- Update Event-specific tests to check appendFileSync calls ---
  describe('Event-specific log functions', () => {
    beforeEach(() => {
      // Ensure simulated dir/file exist for these tests by default
      mockDirExists = true;
      mockFileExists = true;
    });

    test('logDepositCreated should call appendToAuditLog correctly', () => {
      const testDeposit = createTestDeposit({ status: 'QUEUED' });
      logDepositCreated(testDeposit);

      expect(mockAppendFileSync).toHaveBeenCalledTimes(1);
      const [, fileData] = mockAppendFileSync.mock.calls[0];
      const appendedEntry = JSON.parse((fileData as string).trim());
      expect(appendedEntry.eventType).toBe(AuditEventType.DEPOSIT_CREATED);
      expect(appendedEntry.depositId).toBe(testDeposit.id);
      expect(appendedEntry.data.deposit.status).toBe('QUEUED');
    });

    test('logDepositInitialized should call appendToAuditLog correctly', () => {
      const testDeposit = createTestDeposit({
        status: 'INITIALIZED',
        hashes: { eth: { initializeTxHash: 'init-hash' } } as any,
      });
      logDepositInitialized(testDeposit);

      expect(mockAppendFileSync).toHaveBeenCalledTimes(1);
      const [, fileData] = mockAppendFileSync.mock.calls[0];
      const appendedEntry = JSON.parse((fileData as string).trim());
      expect(appendedEntry.eventType).toBe(AuditEventType.DEPOSIT_INITIALIZED);
      expect(appendedEntry.data.txHash).toBe('init-hash');
    });

    test('logDepositFinalized should call appendToAuditLog correctly', () => {
      const testDeposit = createTestDeposit({
        status: 'FINALIZED',
        hashes: { eth: { finalizeTxHash: 'final-hash' } } as any,
      });
      logDepositFinalized(testDeposit);

      expect(mockAppendFileSync).toHaveBeenCalledTimes(1);
      const [, fileData] = mockAppendFileSync.mock.calls[0];
      const appendedEntry = JSON.parse((fileData as string).trim());
      expect(appendedEntry.eventType).toBe(AuditEventType.DEPOSIT_FINALIZED);
      expect(appendedEntry.data.txHash).toBe('final-hash');
    });

    test('logDepositDeleted should call appendToAuditLog correctly', () => {
      const testDeposit = createTestDeposit();
      const reason = 'Test deletion';
      logDepositDeleted(testDeposit, reason);

      expect(mockAppendFileSync).toHaveBeenCalledTimes(1);
      const [, fileData] = mockAppendFileSync.mock.calls[0];
      const appendedEntry = JSON.parse((fileData as string).trim());
      expect(appendedEntry.eventType).toBe(AuditEventType.DEPOSIT_DELETED);
      expect(appendedEntry.data.reason).toBe(reason);
    });

    test('logStatusChange should call appendToAuditLog correctly', () => {
      const testDeposit = createTestDeposit();
      const oldStatus = DepositStatus.QUEUED;
      const newStatus = DepositStatus.INITIALIZED;
      logStatusChange(testDeposit, newStatus, oldStatus);

      expect(mockAppendFileSync).toHaveBeenCalledTimes(1);
      const [, fileData] = mockAppendFileSync.mock.calls[0];
      const appendedEntry = JSON.parse((fileData as string).trim());
      expect(appendedEntry.eventType).toBe(AuditEventType.STATUS_CHANGED);
      expect(appendedEntry.data.from).toBe('QUEUED');
      expect(appendedEntry.data.to).toBe('INITIALIZED');
    });
  });
});
