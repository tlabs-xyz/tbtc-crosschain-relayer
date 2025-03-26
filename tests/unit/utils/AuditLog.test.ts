import fs from 'fs';
import path from 'path';
import { 
  initializeAuditLog, 
  appendToAuditLog, 
  AuditEventType,
  logDepositCreated,
  logDepositInitialized,
  logDepositFinalized,
  logDepositDeleted,
  logStatusChange
} from '../../../utils/AuditLog';
import { DepositStatus } from '../../../types/DepositStatus.enum';
import { createTestDeposit } from '../../mocks/BlockchainMock';
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';

// Set test environment variables
process.env.AUDIT_LOG_DIR = './tests/logs';
process.env.AUDIT_LOG_FILE = 'test-audit.log';
const TEST_LOG_DIR = path.resolve('./tests/logs');
const TEST_LOG_FILE = path.resolve('./tests/logs/test-audit.log');

describe('AuditLog', () => {
  // Setup before each test
  beforeEach(() => {
    // Ensure test directory exists
    if (!fs.existsSync(TEST_LOG_DIR)) {
      fs.mkdirSync(TEST_LOG_DIR, { recursive: true });
    }
    
    // Initialize audit log
    initializeAuditLog();
    
    // Ensure the file exists by writing to it
    if (!fs.existsSync(TEST_LOG_FILE)) {
      fs.writeFileSync(TEST_LOG_FILE, '', 'utf8');
    }
  });
  
  // Clean up after each test
  afterEach(() => {
    // Remove test log file
    if (fs.existsSync(TEST_LOG_FILE)) {
      fs.unlinkSync(TEST_LOG_FILE);
    }
  });
  
  describe('initializeAuditLog', () => {
    test('should create log directory and file if they do not exist', () => {
      // Remove existing log directory and file
      if (fs.existsSync(TEST_LOG_FILE)) {
        fs.unlinkSync(TEST_LOG_FILE);
      }
      if (fs.existsSync(TEST_LOG_DIR)) {
        fs.rmdirSync(TEST_LOG_DIR, { recursive: true });
      }
      
      // Call function to initialize log
      initializeAuditLog();
      
      // Check if directory and file were created
      expect(fs.existsSync(TEST_LOG_DIR)).toBe(true);
      expect(fs.existsSync(TEST_LOG_FILE)).toBe(true);
    });
  });
  
  describe('appendToAuditLog', () => {
    test('should append entry to audit log', () => {
      // Append a test entry to the log
      const testEvent = AuditEventType.DEPOSIT_CREATED;
      const testDepositId = 'test-deposit-id';
      const testData = { testKey: 'testValue' };
      
      appendToAuditLog(testEvent, testDepositId, testData);
      
      // Read log file and verify entry was appended
      const logContent = fs.readFileSync(TEST_LOG_FILE, 'utf8');
      const logEntries = logContent.split('\n').filter(line => line.trim() !== '');
      
      expect(logEntries).toHaveLength(1);
      
      const parsedEntry = JSON.parse(logEntries[0]);
      expect(parsedEntry.eventType).toBe(testEvent);
      expect(parsedEntry.depositId).toBe(testDepositId);
      expect(parsedEntry.data).toEqual(testData);
      expect(parsedEntry.timestamp).toBeDefined();
    });
    
    test('should handle multiple entries', () => {
      // Append multiple entries to the log
      appendToAuditLog(AuditEventType.DEPOSIT_CREATED, 'deposit-1', { id: 1 });
      appendToAuditLog(AuditEventType.DEPOSIT_INITIALIZED, 'deposit-2', { id: 2 });
      appendToAuditLog(AuditEventType.DEPOSIT_FINALIZED, 'deposit-3', { id: 3 });
      
      // Read log file and verify entries were appended
      const logContent = fs.readFileSync(TEST_LOG_FILE, 'utf8');
      const logEntries = logContent.split('\n').filter(line => line.trim() !== '');
      
      expect(logEntries).toHaveLength(3);
      
      const parsedEntries = logEntries.map(entry => JSON.parse(entry));
      
      expect(parsedEntries[0].eventType).toBe(AuditEventType.DEPOSIT_CREATED);
      expect(parsedEntries[0].depositId).toBe('deposit-1');
      expect(parsedEntries[0].data).toEqual({ id: 1 });
      
      expect(parsedEntries[1].eventType).toBe(AuditEventType.DEPOSIT_INITIALIZED);
      expect(parsedEntries[1].depositId).toBe('deposit-2');
      expect(parsedEntries[1].data).toEqual({ id: 2 });
      
      expect(parsedEntries[2].eventType).toBe(AuditEventType.DEPOSIT_FINALIZED);
      expect(parsedEntries[2].depositId).toBe('deposit-3');
      expect(parsedEntries[2].data).toEqual({ id: 3 });
    });
  });
  
  describe('Event-specific log functions', () => {
    test('logDepositCreated should log deposit creation event', () => {
      // Create test deposit
      const testDeposit = createTestDeposit({ status: 'QUEUED' });
      
      // Log deposit creation
      logDepositCreated(testDeposit);
      
      // Read log file and verify entry
      const logContent = fs.readFileSync(TEST_LOG_FILE, 'utf8');
      const logEntries = logContent.split('\n').filter(line => line.trim() !== '');
      
      expect(logEntries).toHaveLength(1);
      
      const parsedEntry = JSON.parse(logEntries[0]);
      expect(parsedEntry.eventType).toBe(AuditEventType.DEPOSIT_CREATED);
      expect(parsedEntry.depositId).toBe(testDeposit.id);
      expect(parsedEntry.data.deposit.id).toBe(testDeposit.id);
      expect(parsedEntry.data.deposit.fundingTxHash).toBe(testDeposit.fundingTxHash);
    });
    
    test('logDepositInitialized should log deposit initialization event', () => {
      // Create test deposit with initialization
      const testDeposit = createTestDeposit({
        status: 'INITIALIZED',
        hashes: {
          btc: {
            btcTxHash: 'btc-tx-hash',
          },
          eth: {
            initializeTxHash: 'initialize-tx-hash',
            finalizeTxHash: null,
          },
        },
      });
      
      // Log deposit initialization
      logDepositInitialized(testDeposit);
      
      // Read log file and verify entry
      const logContent = fs.readFileSync(TEST_LOG_FILE, 'utf8');
      const logEntries = logContent.split('\n').filter(line => line.trim() !== '');
      
      expect(logEntries).toHaveLength(1);
      
      const parsedEntry = JSON.parse(logEntries[0]);
      expect(parsedEntry.eventType).toBe(AuditEventType.DEPOSIT_INITIALIZED);
      expect(parsedEntry.depositId).toBe(testDeposit.id);
      expect(parsedEntry.data.deposit.id).toBe(testDeposit.id);
      expect(parsedEntry.data.txHash).toBe('initialize-tx-hash');
    });
    
    test('logDepositFinalized should log deposit finalization event', () => {
      // Create test deposit with finalization
      const testDeposit = createTestDeposit({
        status: 'FINALIZED',
        hashes: {
          btc: {
            btcTxHash: 'btc-tx-hash',
          },
          eth: {
            initializeTxHash: 'initialize-tx-hash',
            finalizeTxHash: 'finalize-tx-hash',
          },
        },
      });
      
      // Log deposit finalization
      logDepositFinalized(testDeposit);
      
      // Read log file and verify entry
      const logContent = fs.readFileSync(TEST_LOG_FILE, 'utf8');
      const logEntries = logContent.split('\n').filter(line => line.trim() !== '');
      
      expect(logEntries).toHaveLength(1);
      
      const parsedEntry = JSON.parse(logEntries[0]);
      expect(parsedEntry.eventType).toBe(AuditEventType.DEPOSIT_FINALIZED);
      expect(parsedEntry.depositId).toBe(testDeposit.id);
      expect(parsedEntry.data.deposit.id).toBe(testDeposit.id);
      expect(parsedEntry.data.txHash).toBe('finalize-tx-hash');
    });
    
    test('logDepositDeleted should log deposit deletion event', () => {
      // Create test deposit
      const testDeposit = createTestDeposit();
      
      // Log deposit deletion
      const reason = 'Test deletion reason';
      logDepositDeleted(testDeposit, reason);
      
      // Read log file and verify entry
      const logContent = fs.readFileSync(TEST_LOG_FILE, 'utf8');
      const logEntries = logContent.split('\n').filter(line => line.trim() !== '');
      
      expect(logEntries).toHaveLength(1);
      
      const parsedEntry = JSON.parse(logEntries[0]);
      expect(parsedEntry.eventType).toBe(AuditEventType.DEPOSIT_DELETED);
      expect(parsedEntry.depositId).toBe(testDeposit.id);
      expect(parsedEntry.data.deposit.id).toBe(testDeposit.id);
      expect(parsedEntry.data.reason).toBe(reason);
    });
    
    test('logStatusChange should log status change event', () => {
      // Create test deposit
      const testDeposit = createTestDeposit();
      
      // Log status change
      const oldStatus = DepositStatus.QUEUED;
      const newStatus = DepositStatus.INITIALIZED;
      logStatusChange(testDeposit, newStatus, oldStatus);
      
      // Read log file and verify entry
      const logContent = fs.readFileSync(TEST_LOG_FILE, 'utf8');
      const logEntries = logContent.split('\n').filter(line => line.trim() !== '');
      
      expect(logEntries).toHaveLength(1);
      
      const parsedEntry = JSON.parse(logEntries[0]);
      expect(parsedEntry.eventType).toBe(AuditEventType.STATUS_CHANGED);
      expect(parsedEntry.depositId).toBe(testDeposit.id);
      expect(parsedEntry.data.from).toBe('QUEUED');
      expect(parsedEntry.data.to).toBe('INITIALIZED');
    });
  });
}); 