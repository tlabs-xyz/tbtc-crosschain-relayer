// Test setup file for Jest
// This file is run before each test file

// Import all mocks
import './mocks/fetch.mock.js';
import './mocks/ethers.mock.js';
import './mocks/Logger.mock.js';
import './mocks/Deposit.mock.js';

// Mock console methods to reduce noise in tests
const originalConsole = { ...console };

beforeEach(() => {
  // Suppress console output during tests unless explicitly needed
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  
  // Reset all mocks
  jest.clearAllMocks();
});

afterEach(() => {
  // Restore console methods
  jest.restoreAllMocks();
});

// Global test timeout
jest.setTimeout(10000);