import fs from 'fs';
import path from 'path';
import { 
  checkAndCreateDataFolder, 
  getJsonById, 
  writeJson, 
  deleteJson, 
  getAllJsonOperations, 
  getAllJsonOperationsByStatus
} from '../../../utils/JsonUtils';
import { createTestDeposit } from '../../mocks/BlockchainMock';
import { describe, test, expect, beforeAll, afterEach } from '@jest/globals';

// Set test environment variables
process.env.JSON_PATH = './tests/data/';
const TEST_DIR = path.resolve('./tests/data');

describe('JsonUtils', () => {
  // Setup before all tests
  beforeAll(() => {
    // Ensure test directory exists
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });
  
  // Clean up after each test
  afterEach(() => {
    // Clean up test files after each test
    if (fs.existsSync(TEST_DIR)) {
      const files = fs.readdirSync(TEST_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(TEST_DIR, file));
      }
    }
  });
  
  describe('checkAndCreateDataFolder', () => {
    test('should create data folder if it does not exist', () => {
      // Remove folder if it exists
      if (fs.existsSync(TEST_DIR)) {
        fs.rmdirSync(TEST_DIR, { recursive: true });
      }
      
      // Call function to create folder
      checkAndCreateDataFolder();
      
      // Check if folder was created
      expect(fs.existsSync(TEST_DIR)).toBe(true);
    });
    
    test('should not throw error if folder already exists', () => {
      // Create folder
      if (!fs.existsSync(TEST_DIR)) {
        fs.mkdirSync(TEST_DIR, { recursive: true });
      }
      
      // Call function should not throw error
      expect(() => checkAndCreateDataFolder()).not.toThrow();
    });
  });
  
  describe('writeJson and getJsonById', () => {
    test('should write a deposit to a JSON file and retrieve it', () => {
      // Create test deposit
      const testDeposit = createTestDeposit();
      
      // Write deposit to file
      const result = writeJson(testDeposit, testDeposit.id);
      
      // Check if write was successful
      expect(result).toBe(true);
      
      // Check if file exists
      const filePath = path.join(TEST_DIR, `${testDeposit.id}.json`);
      expect(fs.existsSync(filePath)).toBe(true);
      
      // Read file and check content
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const parsedContent = JSON.parse(fileContent);
      expect(parsedContent).toEqual(testDeposit);
      
      // Get deposit by ID
      const retrievedDeposit = getJsonById(testDeposit.id);
      expect(retrievedDeposit).toEqual(testDeposit);
    });
    
    test('should return null when getting a non-existent deposit', () => {
      const nonExistentId = 'non-existent-id';
      const result = getJsonById(nonExistentId);
      expect(result).toBeNull();
    });
  });
  
  describe('deleteJson', () => {
    test('should delete a JSON file', () => {
      // Create test deposit
      const testDeposit = createTestDeposit();
      
      // Write deposit to file
      writeJson(testDeposit, testDeposit.id);
      
      // Verify file exists
      const filePath = path.join(TEST_DIR, `${testDeposit.id}.json`);
      expect(fs.existsSync(filePath)).toBe(true);
      
      // Delete file
      const result = deleteJson(testDeposit.id);
      
      // Check if delete was successful
      expect(result).toBe(true);
      
      // Verify file no longer exists
      expect(fs.existsSync(filePath)).toBe(false);
    });
    
    test('should return false when deleting a non-existent file', () => {
      const nonExistentId = 'non-existent-id';
      const result = deleteJson(nonExistentId);
      expect(result).toBe(false);
    });
  });
  
  describe('getAllJsonOperations and getAllJsonOperationsByStatus', () => {
    test('should get all JSON operations', async () => {
      // Create test deposits with different statuses
      const queuedDeposit = createTestDeposit({ status: 'QUEUED' });
      const initializedDeposit = createTestDeposit({ status: 'INITIALIZED' });
      const finalizedDeposit = createTestDeposit({ status: 'FINALIZED' });
      
      // Write deposits to files
      writeJson(queuedDeposit, queuedDeposit.id);
      writeJson(initializedDeposit, initializedDeposit.id);
      writeJson(finalizedDeposit, finalizedDeposit.id);
      
      // Get all operations
      const allOperations = await getAllJsonOperations();
      
      // Check if all deposits were retrieved
      expect(allOperations).toHaveLength(3);
      expect(allOperations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: queuedDeposit.id }),
          expect.objectContaining({ id: initializedDeposit.id }),
          expect.objectContaining({ id: finalizedDeposit.id })
        ])
      );
    });
    
    test('should get operations by status', async () => {
      // Create test deposits with different statuses
      const queuedDeposit1 = createTestDeposit({ status: 'QUEUED' });
      const queuedDeposit2 = createTestDeposit({ status: 'QUEUED' });
      const initializedDeposit = createTestDeposit({ status: 'INITIALIZED' });
      const finalizedDeposit = createTestDeposit({ status: 'FINALIZED' });
      
      // Write deposits to files
      writeJson(queuedDeposit1, queuedDeposit1.id);
      writeJson(queuedDeposit2, queuedDeposit2.id);
      writeJson(initializedDeposit, initializedDeposit.id);
      writeJson(finalizedDeposit, finalizedDeposit.id);
      
      // Get operations by status
      const queuedOperations = await getAllJsonOperationsByStatus('QUEUED');
      const initializedOperations = await getAllJsonOperationsByStatus('INITIALIZED');
      const finalizedOperations = await getAllJsonOperationsByStatus('FINALIZED');
      
      // Check if deposits were retrieved correctly by status
      expect(queuedOperations).toHaveLength(2);
      expect(initializedOperations).toHaveLength(1);
      expect(finalizedOperations).toHaveLength(1);
      
      expect(queuedOperations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: queuedDeposit1.id }),
          expect.objectContaining({ id: queuedDeposit2.id })
        ])
      );
      
      expect(initializedOperations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: initializedDeposit.id })
        ])
      );
      
      expect(finalizedOperations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: finalizedDeposit.id })
        ])
      );
    });
  });
}); 