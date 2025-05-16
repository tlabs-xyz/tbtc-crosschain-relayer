import fs_actual from 'fs';
import path from 'path';
import { Deposit } from '../../../types/Deposit.type.js';
import { DepositStatus } from '../../../types/DepositStatus.enum.js';
import { FundingTransaction } from '../../../types/FundingTransaction.type.js';
import { Reveal } from '../../../types/Reveal.type.js';
import { createTestDeposit } from '../../mocks/BlockchainMock';
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Set test environment variables
process.env.JSON_PATH = './tests/data/';
const TEST_DATA_DIR = path.resolve(process.env.JSON_PATH || './tests/data');

let mockFileStore: { [key: string]: string } = {};
let mockDirExistsStore: { [key: string]: boolean } = {};

let mockExistsSyncFn: any;
let mockMkdirSyncFn: any;
let mockWriteFileSyncFn: any;
let mockReadFileSyncFn: any;
let mockUnlinkSyncFn: any;
let mockReaddirFn: any;
let mockReadFileFn: any;

let JsonUtilsModule: typeof import('../../../utils/JsonUtils');

describe('JsonUtils', () => {
  beforeEach(() => {
    mockFileStore = {};
    mockDirExistsStore = {};

    if (fs_actual.existsSync(TEST_DATA_DIR)) {
      fs_actual.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }

    jest.doMock('fs', () => {
      const existsSyncMock = jest.fn((p: string) => {
        const pathStr = path.resolve(p);
        return !!mockFileStore[pathStr] || !!mockDirExistsStore[pathStr];
      });
      mockExistsSyncFn = existsSyncMock;

      const mkdirSyncMock = jest.fn((p: string) => {
        const pathStr = path.resolve(p);
        mockDirExistsStore[pathStr] = true;
        let parent = path.dirname(pathStr);
        while (parent !== path.dirname(parent)) {
          mockDirExistsStore[parent] = true;
          parent = path.dirname(parent);
        }
      });
      mockMkdirSyncFn = mkdirSyncMock;

      const writeFileSyncMock = jest.fn((p: string, data: string, encoding: string) => {
        const pathStr = path.resolve(p);
        const dirPath = path.dirname(pathStr);
        if (!mockDirExistsStore[dirPath]) {
          mockDirExistsStore[dirPath] = true;
        }
        mockFileStore[pathStr] = data;
      });
      mockWriteFileSyncFn = writeFileSyncMock;

      const readFileSyncMock = jest.fn((p: string) => {
        const pathStr = path.resolve(p);
        if (mockFileStore[pathStr] !== undefined) {
          return mockFileStore[pathStr];
        }
        const error: NodeJS.ErrnoException = new Error(
          `ENOENT: no such file or directory, open '${pathStr}'`,
        );
        error.code = 'ENOENT';
        throw error;
      });
      mockReadFileSyncFn = readFileSyncMock;

      const unlinkSyncMock = jest.fn((p: string) => {
        const pathStr = path.resolve(p);
        if (mockFileStore[pathStr] !== undefined) {
          delete mockFileStore[pathStr];
        } else {
          const error: NodeJS.ErrnoException = new Error(
            `ENOENT: no such file or directory, open '${pathStr}'`,
          );
          error.code = 'ENOENT';
          throw error;
        }
      });
      mockUnlinkSyncFn = unlinkSyncMock;

      const readdirMock = jest.fn(async (p: string) => {
        const dirPathStr = path.resolve(p);
        if (!mockDirExistsStore[dirPathStr]) {
          const error: NodeJS.ErrnoException = new Error(
            `ENOENT: no such file or directory, scandir '${dirPathStr}'`,
          );
          error.code = 'ENOENT';
          throw error;
        }
        return Object.keys(mockFileStore)
          .filter((filePath) => path.dirname(filePath) === dirPathStr)
          .map((filePath) => path.basename(filePath));
      });
      mockReaddirFn = readdirMock;

      const readFileMock = jest.fn(async (fp: string, enc?: string) => mockReadFileSyncFn(fp));
      mockReadFileFn = readFileMock;

      return {
        __esModule: true,
        default: {
          existsSync: existsSyncMock,
          mkdirSync: mkdirSyncMock,
          writeFileSync: writeFileSyncMock,
          readFileSync: readFileSyncMock,
          unlinkSync: unlinkSyncMock,
          promises: {
            readdir: readdirMock,
            readFile: readFileMock,
          },
        },
        existsSync: existsSyncMock,
        mkdirSync: mkdirSyncMock,
        writeFileSync: writeFileSyncMock,
        readFileSync: readFileSyncMock,
        unlinkSync: unlinkSyncMock,
        promises: {
          readdir: readdirMock,
          readFile: readFileMock,
        },
      };
    });

    jest.resetModules();
    // Re-evaluate JsonUtilsModule to ensure it uses the mocked fs
    JsonUtilsModule = require('../../../utils/JsonUtils');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  describe('checkAndCreateDataFolder', () => {
    test('should create data folder if it does not exist', () => {
      JsonUtilsModule.checkAndCreateDataFolder();
      expect(mockMkdirSyncFn).toHaveBeenCalledWith(TEST_DATA_DIR);
    });

    test('should not throw error if folder already exists', () => {
      mockDirExistsStore[TEST_DATA_DIR] = true;
      expect(() => JsonUtilsModule.checkAndCreateDataFolder()).not.toThrow();
      expect(mockMkdirSyncFn).not.toHaveBeenCalled();
    });
  });

  describe('writeJson and getJsonById', () => {
    const mockFundingTx: FundingTransaction = {
      version: '0x1',
      inputVector: '0xinputvector',
      outputVector: '0xoutputvector',
      locktime: '0xlocktime',
    };

    const mockReveal: Reveal = [
      1, // version (number)
      '0xblindingfactor_reveal', // blindingFactor (string)
      '0xwalletpubkeyhash_reveal', // walletPublicKeyHash (string)
      '0xrefundpubkeyhash_reveal', // refundPublicKeyHash (string)
      '0xrefundlocktime_reveal', // refundLocktime (string)
      '0xextradata_reveal', // extraData (string)
      // vault, value, outpoint, depositor are not part of the Reveal tuple type
    ];

    const testDeposit: Deposit = {
      id: '0xe4ff32db7d3c1cf9ce0cea53d1916d3ea10b627d2faf9cedb31868f6b5cce32e',
      fundingTxHash: '0xfundingtxhash_direct',
      outputIndex: 0,
      hashes: {
        btc: { btcTxHash: '0xbtctxhash' },
        eth: { initializeTxHash: null, finalizeTxHash: null },
        solana: { bridgeTxHash: null },
      },
      receipt: {
        depositor: '0xdepositor_receipt',
        blindingFactor: '0xblindingfactor_receipt',
        walletPublicKeyHash: '0xwalletpubkeyhash_receipt',
        refundPublicKeyHash: '0xrefundpubkeyhash_receipt',
        refundLocktime: '0xrefundlocktime_receipt',
        extraData: '0xextradata_receipt',
      },
      owner: '0xOwner',
      status: DepositStatus.QUEUED,
      L1OutputEvent: {
        fundingTx: mockFundingTx,
        reveal: mockReveal,
        l2DepositOwner: '0xl2owner',
        l2Sender: '0xl2sender',
      },
      dates: {
        createdAt: new Date().getTime(),
        initializationAt: null,
        finalizationAt: null,
        lastActivityAt: new Date().getTime(),
        awaitingWormholeVAAMessageSince: null,
        bridgedAt: null,
      },
      wormholeInfo: {
        txHash: null,
        transferSequence: null,
        bridgingAttempted: false,
      },
      error: null,
    };

    const expectedFilePath = path.resolve(TEST_DATA_DIR, `${testDeposit.id}.json`);

    test('should write a deposit to a JSON file and retrieve it', () => {
      mockExistsSyncFn.mockReturnValue(true);
      mockReadFileSyncFn.mockReturnValue(JSON.stringify(testDeposit));

      JsonUtilsModule.writeJson(testDeposit, testDeposit.id);
      const retrievedDeposit = JsonUtilsModule.getJsonById(testDeposit.id);

      expect(mockWriteFileSyncFn).toHaveBeenCalledWith(
        expectedFilePath,
        JSON.stringify(testDeposit, null, 2),
        'utf8',
      );
      expect(retrievedDeposit).toEqual(testDeposit);
      expect(mockReadFileSyncFn).toHaveBeenCalledWith(expectedFilePath, 'utf8');
    });

    test('should return null when getting a non-existent deposit', () => {
      const nonExistentId = 'non-existent-id';
      const nonExistentFilePath = path.resolve(TEST_DATA_DIR, `${nonExistentId}.json`);

      mockExistsSyncFn.mockReturnValue(false); // Simulate file not existing

      const result = JsonUtilsModule.getJsonById(nonExistentId);

      expect(result).toBeNull();
      // Verify existsSync was called for the non-existent file path
      expect(mockExistsSyncFn).toHaveBeenCalledWith(nonExistentFilePath);
      // Verify readFileSync was NOT called because existsSync returned false
      expect(mockReadFileSyncFn).not.toHaveBeenCalled();
    });
  });

  describe('deleteJson', () => {
    test('should delete a JSON file', () => {
      const testDeposit = createTestDeposit();
      const filePath = path.resolve(TEST_DATA_DIR, `${testDeposit.id}.json`);
      mockFileStore[filePath] = JSON.stringify(testDeposit);
      mockDirExistsStore[path.dirname(filePath)] = true;

      const result = JsonUtilsModule.deleteJson(testDeposit.id);
      expect(result).toBe(true);
      expect(mockUnlinkSyncFn).toHaveBeenCalledWith(filePath);
      expect(mockFileStore[filePath]).toBeUndefined();
    });

    test('should return false when deleting a non-existent file', () => {
      const nonExistentId = 'non-existent-id';
      const nonExistentFilePath = path.resolve(TEST_DATA_DIR, `${nonExistentId}.json`);
      mockExistsSyncFn.mockImplementation((p: string) => p !== nonExistentFilePath); // Explicitly mock non-existence

      const result = JsonUtilsModule.deleteJson(nonExistentId);
      expect(result).toBe(false);
      expect(mockExistsSyncFn).toHaveBeenCalledWith(nonExistentFilePath);
      expect(mockUnlinkSyncFn).not.toHaveBeenCalled();
    });
  });

  describe('getAllJsonOperations and getAllJsonOperationsByStatus', () => {
    test('should get all JSON operations', async () => {
      const queuedDeposit = createTestDeposit({ status: DepositStatus.QUEUED });
      const initializedDeposit = createTestDeposit({ status: DepositStatus.INITIALIZED });
      mockFileStore[path.resolve(TEST_DATA_DIR, `${queuedDeposit.id}.json`)] =
        JSON.stringify(queuedDeposit);
      mockFileStore[path.resolve(TEST_DATA_DIR, `${initializedDeposit.id}.json`)] =
        JSON.stringify(initializedDeposit);
      mockDirExistsStore[TEST_DATA_DIR] = true;

      const allOperations = await JsonUtilsModule.getAllJsonOperations();
      expect(mockReaddirFn).toHaveBeenCalledWith(TEST_DATA_DIR);
      expect(allOperations).toHaveLength(2);
      expect(allOperations).toEqual(expect.arrayContaining([queuedDeposit, initializedDeposit]));
      // Ensure readFile was called for each file found by readdir
      expect(mockReadFileFn).toHaveBeenCalledTimes(2);
      expect(mockReadFileFn).toHaveBeenCalledWith(
        path.resolve(TEST_DATA_DIR, `${queuedDeposit.id}.json`),
        'utf8',
      );
      expect(mockReadFileFn).toHaveBeenCalledWith(
        path.resolve(TEST_DATA_DIR, `${initializedDeposit.id}.json`),
        'utf8',
      );
    });

    test('should get operations by status', async () => {
      const queuedDeposit1 = createTestDeposit({ status: DepositStatus.QUEUED });
      const queuedDeposit2 = createTestDeposit({ status: DepositStatus.QUEUED });
      const initializedDeposit = createTestDeposit({ status: DepositStatus.INITIALIZED });
      mockFileStore[path.resolve(TEST_DATA_DIR, `${queuedDeposit1.id}.json`)] =
        JSON.stringify(queuedDeposit1);
      mockFileStore[path.resolve(TEST_DATA_DIR, `${queuedDeposit2.id}.json`)] =
        JSON.stringify(queuedDeposit2);
      mockFileStore[path.resolve(TEST_DATA_DIR, `${initializedDeposit.id}.json`)] =
        JSON.stringify(initializedDeposit);
      mockDirExistsStore[TEST_DATA_DIR] = true;

      const initializedOperations = await JsonUtilsModule.getAllJsonOperationsByStatus(
        DepositStatus.INITIALIZED,
      );
      expect(initializedOperations).toHaveLength(1);
      expect(initializedOperations[0]).toEqual(initializedDeposit);

      const queuedOperations = await JsonUtilsModule.getAllJsonOperationsByStatus(
        DepositStatus.QUEUED,
      );
      expect(queuedOperations).toHaveLength(2);
      expect(queuedOperations).toEqual(expect.arrayContaining([queuedDeposit1, queuedDeposit2]));

      // Check calls for getAllJsonOperationsByStatus. It calls getAllJsonOperations internally.
      // So readdir is called once per call to getAllJsonOperations.
      // readFile is called for each file by getAllJsonOperations.
      // Assuming 2 calls to getAllJsonOperationsByStatus means 2 calls to getAllJsonOperations.
      expect(mockReaddirFn).toHaveBeenCalledTimes(2); // Once for INITIALIZED, once for QUEUED
      expect(mockReadFileFn).toHaveBeenCalledTimes(3 + 3); // 3 files read for first call, 3 for second.
    });

    test('should return empty array if no files match status', async () => {
      mockDirExistsStore[TEST_DATA_DIR] = true;
      const finalizedOperations = await JsonUtilsModule.getAllJsonOperationsByStatus(
        DepositStatus.FINALIZED,
      );
      expect(finalizedOperations).toHaveLength(0);
      expect(mockReaddirFn).toHaveBeenCalledWith(TEST_DATA_DIR);
      expect(mockReadFileFn).not.toHaveBeenCalled(); // No files to read
    });

    test('should throw error if readdir fails other than ENOENT for getAllJsonOperations', async () => {
      mockDirExistsStore[TEST_DATA_DIR] = true;
      mockReaddirFn.mockImplementationOnce(async () => {
        const err = new Error('EPERM: operation not permitted') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      });
      await expect(JsonUtilsModule.getAllJsonOperations()).rejects.toThrow(
        'EPERM: operation not permitted',
      );
    });

    test('should return empty array if data directory does not exist for getAllJsonOperations', async () => {
      delete mockDirExistsStore[TEST_DATA_DIR];
      const operations = await JsonUtilsModule.getAllJsonOperations();
      expect(operations).toEqual([]);
      expect(mockReaddirFn).toHaveBeenCalledWith(TEST_DATA_DIR);
      expect(mockReadFileFn).not.toHaveBeenCalled();
    });
  });
});
