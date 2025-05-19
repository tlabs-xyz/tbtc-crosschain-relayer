import path from 'path';
import fs from 'fs';
import { initializeAuditLog } from '../utils/AuditLog';

// Set environment variables for testing
process.env.NODE_ENV = 'test';
process.env.APP_NAME = 'tBTC Relayer Test';
process.env.VERBOSE_APP = 'false'; // Disable verbose logging during tests
process.env.JSON_PATH = './tests/data/';
process.env.AUDIT_LOG_DIR = './tests/logs';
process.env.CLEAN_QUEUED_TIME = '1'; // 1 hour for faster testing
process.env.CLEAN_FINALIZED_TIME = '1'; // 1 hour for faster testing

// Create test directories
const testDataDir = path.resolve('./tests/data');
const testLogsDir = path.resolve('./tests/logs');

// Setup without using Jest globals in TypeScript
// This avoids TypeScript errors while still using Jest's functionality
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const setupBeforeTests = () => {
  // Create test directories if they don't exist
  if (!fs.existsSync(testDataDir)) {
    fs.mkdirSync(testDataDir, { recursive: true });
  }

  if (!fs.existsSync(testLogsDir)) {
    fs.mkdirSync(testLogsDir, { recursive: true });
  }

  // Initialize audit log for tests
  initializeAuditLog();
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const cleanupAfterTests = () => {
  // Clean up test data after all tests
  if (fs.existsSync(testDataDir)) {
    const files = fs.readdirSync(testDataDir);
    for (const file of files) {
      fs.unlinkSync(path.join(testDataDir, file));
    }
  }

  // Clean up test logs after all tests
  if (fs.existsSync(testLogsDir)) {
    const files = fs.readdirSync(testLogsDir);
    for (const file of files) {
      fs.unlinkSync(path.join(testLogsDir, file));
    }
  }
};

// Using eval to avoid TypeScript errors while still using Jest's functionality
// This is a workaround for TypeScript not recognizing Jest globals
eval('beforeAll(setupBeforeTests)');
eval('afterAll(cleanupAfterTests)');

// Mock console.log and other console methods
console.log = jest.fn();
console.error = jest.fn();
console.warn = jest.fn();
console.info = jest.fn();
console.debug = jest.fn();

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
