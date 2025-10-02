import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { mockDeposit } from '../../mocks/Deposit.mock.js';

// Create a mock BigNumber helper
const createMockBigNumber = (value: string) => ({
  toString: () => value,
  add: jest.fn((other: any) => {
    const result = (parseInt(value) + parseInt(String(other.toString ? other.toString() : other))).toString();
    return createMockBigNumber(result);
  }),
  lt: jest.fn((other: any) => parseInt(value) < parseInt(String(other.toString ? other.toString() : other))),
});

// Mock ethers before importing L1DepositorService
const mockProvider = {
  getBalance: jest.fn().mockResolvedValue(createMockBigNumber('2000000000000000000')),
  getTransactionCount: jest.fn().mockResolvedValue(42),
};

const mockSigner = {
  getBalance: jest.fn().mockResolvedValue(createMockBigNumber('2000000000000000000')),
  getTransactionCount: jest.fn().mockResolvedValue(42),
  connect: jest.fn().mockReturnThis(),
};

const mockContract = {
  initializeDeposit: jest.fn(),
  setExecutorParameters: jest.fn(),
  finalizeDeposit: jest.fn(),
  quoteFinalizeDeposit: jest.fn(),
  quoteFinalizedDeposit: jest.fn(), // Note: different method name used in getCostBreakdown
  areExecutorParametersSet: jest.fn(),
  getStoredExecutorValue: jest.fn(),
  clearExecutorParameters: jest.fn(),
  encodeDestinationReceiver: jest.fn(),
};

jest.mock('ethers', () => ({
  ethers: {
    providers: {
      JsonRpcProvider: jest.fn(() => mockProvider),
    },
    Wallet: jest.fn(() => mockSigner),
    Contract: jest.fn(() => mockContract),
    utils: {
      keccak256: jest.fn((data) => '0x' + 'a'.repeat(64)),
      toUtf8Bytes: jest.fn((str) => '0x' + Buffer.from(String(str)).toString('hex')),
      isAddress: jest.fn(() => true),
      formatEther: jest.fn((value) => (parseInt(String(value)) / 1e18).toFixed(18)),
      hexlify: jest.fn((value) => '0x' + String(value).toString(16)),
      hexZeroPad: jest.fn((value, length) => {
        const hex = String(value).replace('0x', '');
        return '0x' + hex.padStart(length * 2, '0');
      }),
    },
    BigNumber: {
      from: jest.fn((value) => {
        const numValue = String(value);
        return {
          toString: () => numValue,
          add: jest.fn((other) => {
            const result = (parseInt(numValue) + parseInt(String(other.toString ? other.toString() : other))).toString();
            return {
              toString: () => result,
              lt: jest.fn((comp) => parseInt(result) < parseInt(String(comp.toString ? comp.toString() : comp))),
            };
          }),
          lt: jest.fn((other) => parseInt(numValue) < parseInt(String(other.toString ? other.toString() : other))),
        };
      }),
      isBigNumber: jest.fn(() => true),
    },
    constants: {
      AddressZero: '0x0000000000000000000000000000000000000000',
    },
  },
}));

// Import after mocking
import { L1DepositorService } from '../../../services/L1DepositorService.js';

describe('L1DepositorService', () => {
  let depositorService: L1DepositorService;

  beforeEach(() => {
    // Clear all mock calls
    jest.clearAllMocks();
    
    // Create new service instance
    depositorService = new L1DepositorService(
      'https://eth-mainnet.alchemyapi.io/v2/test',
      '0x1234567890123456789012345678901234567890123456789012345678901234',
      '0x1234567890123456789012345678901234567890',
      '0x2345678901234567890123456789012345678901',
      '0x3456789012345678901234567890123456789012'
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initializeDeposit', () => {
    test('should initialize deposit successfully', async () => {
      const mockTx = { hash: '0xinit123', wait: jest.fn().mockResolvedValue({}) };
      mockContract.initializeDeposit.mockResolvedValue(mockTx);
      mockContract.encodeDestinationReceiver.mockResolvedValue('0xencoded');

      const result = await depositorService.initializeDeposit(
        mockDeposit,
        '0x1234567890123456789012345678901234567890',
        40
      );

      expect(result).toBe('0xinit123');
      expect(mockContract.initializeDeposit).toHaveBeenCalled();
      expect(mockContract.encodeDestinationReceiver).toHaveBeenCalled();
    });

    test('should handle initialization error', async () => {
      mockContract.initializeDeposit.mockRejectedValue(new Error('Contract error'));

      await expect(
        depositorService.initializeDeposit(
          mockDeposit,
          '0x1234567890123456789012345678901234567890',
          40
        )
      ).rejects.toThrow('Contract error');
    });
  });

  describe('setExecutorParameters', () => {
    test('should set executor parameters successfully', async () => {
      const mockTx = { hash: '0xexec123', wait: jest.fn().mockResolvedValue({}) };
      mockContract.setExecutorParameters.mockResolvedValue(mockTx);
      mockContract.areExecutorParametersSet.mockResolvedValue([true, '0xnonce123']);

      const result = await depositorService.setExecutorParameters(
        40,
        '0x1234567890123456789012345678901234567890',
        500000,
        0,
        '0x0000000000000000000000000000000000000000'
      );

      expect(result).toBe('0xnonce123'); // Returns the nonce, not the tx hash
      expect(mockContract.setExecutorParameters).toHaveBeenCalled();
    });
  });

  describe('finalizeDeposit', () => {
    test('should finalize deposit successfully', async () => {
      const mockReceipt = { transactionHash: '0xfinal123' };
      const mockTx = { hash: '0xfinal123', wait: jest.fn().mockResolvedValue(mockReceipt) };
      mockContract.finalizeDeposit.mockResolvedValue(mockTx);
      mockContract.quoteFinalizeDeposit.mockResolvedValue([
        '500000000000000000', // nttDeliveryPrice
        '500000000000000000', // executorCost
        '1000000000000000000', // totalCost
      ]);

      const result = await depositorService.finalizeDeposit(mockDeposit, '500000000000000000');

      expect(result).toEqual(mockReceipt);
      expect(mockContract.finalizeDeposit).toHaveBeenCalled();
    });

    test('should handle insufficient balance', async () => {
      mockSigner.getBalance.mockResolvedValue(createMockBigNumber('100000000000000000')); // 0.1 ETH
      mockContract.quoteFinalizeDeposit.mockResolvedValue([
        '500000000000000000', // nttDeliveryPrice
        '500000000000000000', // executorCost
        '1000000000000000000', // totalCost
      ]);

      await expect(
        depositorService.finalizeDeposit(mockDeposit, '500000000000000000')
      ).rejects.toThrow('Insufficient balance');
    });
  });

  describe('completeDepositFlow', () => {
    test('should complete full deposit flow', async () => {
      const mockInitTx = { hash: '0xinit123', wait: jest.fn().mockResolvedValue({}) };
      const mockExecTx = { hash: '0xexec123', wait: jest.fn().mockResolvedValue({}) };
      const mockFinalReceipt = { transactionHash: '0xfinal123' };
      const mockFinalTx = { hash: '0xfinal123', wait: jest.fn().mockResolvedValue(mockFinalReceipt) };

      // Ensure sufficient balance for finalization
      mockSigner.getBalance.mockResolvedValue(createMockBigNumber('2000000000000000000')); // 2 ETH

      mockContract.initializeDeposit.mockResolvedValue(mockInitTx);
      mockContract.setExecutorParameters.mockResolvedValue(mockExecTx);
      mockContract.areExecutorParametersSet.mockResolvedValue([true, '0xnonce123']);
      mockContract.getStoredExecutorValue.mockResolvedValue('500000000000000000');
      mockContract.finalizeDeposit.mockResolvedValue(mockFinalTx);
      mockContract.quoteFinalizeDeposit.mockResolvedValue([
        '500000000000000000',
        '500000000000000000',
        '1000000000000000000',
      ]);
      mockContract.encodeDestinationReceiver.mockResolvedValue('0xencoded');

      const result = await depositorService.completeDepositFlow(
        mockDeposit,
        '0x1234567890123456789012345678901234567890',
        40,
        '0x1234567890123456789012345678901234567890'
      );

      expect(result).toEqual(mockFinalReceipt);
      expect(mockContract.initializeDeposit).toHaveBeenCalled();
      expect(mockContract.setExecutorParameters).toHaveBeenCalled();
      expect(mockContract.finalizeDeposit).toHaveBeenCalled();
    });
  });

  describe('getCostBreakdown', () => {
    test('should get cost breakdown', async () => {
      mockContract.quoteFinalizedDeposit.mockResolvedValue([
        '500000000000000000',
        '500000000000000000',
        '1000000000000000000',
      ]);

      const result = await depositorService.getCostBreakdown(40);

      expect(result).toHaveProperty('nttDeliveryPrice');
      expect(result).toHaveProperty('executorCost');
      expect(result).toHaveProperty('totalCost');
    });
  });

  describe('areExecutorParametersSet', () => {
    test('should check if executor parameters are set', async () => {
      mockContract.areExecutorParametersSet.mockResolvedValue([true, '0xhash123']);

      const result = await depositorService.areExecutorParametersSet();

      expect(result).toEqual({ isSet: true, nonce: '0xhash123' });
    });
  });

  describe('clearExecutorParameters', () => {
    test('should clear executor parameters', async () => {
      const mockTx = { wait: jest.fn().mockResolvedValue({}) };
      mockContract.clearExecutorParameters.mockResolvedValue(mockTx);

      await depositorService.clearExecutorParameters();

      expect(mockContract.clearExecutorParameters).toHaveBeenCalled();
    });
  });
});