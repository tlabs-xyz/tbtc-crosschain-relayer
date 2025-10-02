import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ExecutorService } from '../../../services/ExecutorService.js';

// ethers and fetch are already mocked in setup.ts

describe('ExecutorService', () => {
  let executorService: ExecutorService;

  beforeEach(() => {
    executorService = new ExecutorService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateExecutorParameters', () => {
    test('should generate executor parameters successfully', async () => {
      const result = await executorService.generateExecutorParameters(
        2, // Ethereum source chain
        40, // SeiEVM destination chain
        '0x1234567890123456789012345678901234567890', // refund address
        '0x01' // relay instructions
      );

      expect(result).toHaveProperty('executorArgs');
      expect(result).toHaveProperty('estimatedCost');
      expect(result.executorArgs).toHaveProperty('value');
      expect(result.executorArgs).toHaveProperty('refundAddress');
      expect(result.executorArgs).toHaveProperty('signedQuote');
      expect(result.executorArgs).toHaveProperty('instructions');
    });

    test('should throw error for invalid refund address', async () => {
      await expect(
        executorService.generateExecutorParameters(
          2,
          40,
          'invalid-address',
          '0x01'
        )
      ).rejects.toThrow('Invalid refund address provided');
    });

    test('should handle API failure', async () => {
      // Mock fetch to return error
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(
        executorService.generateExecutorParameters(
          2,
          40,
          '0x1234567890123456789012345678901234567890',
          '0x01'
        )
      ).rejects.toThrow('Executor API error: 500 Internal Server Error');
    });

    test('should handle invalid API response', async () => {
      // Mock fetch to return invalid response
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          // Missing signedQuote and estimatedCost
        }),
      });

      await expect(
        executorService.generateExecutorParameters(
          2,
          40,
          '0x1234567890123456789012345678901234567890',
          '0x01'
        )
      ).rejects.toThrow('Invalid executor API response: missing signedQuote or estimatedCost');
    });
  });

  describe('generateFeeArgs', () => {
    test('should generate valid fee args', () => {
      const result = executorService.generateFeeArgs(100, '0x1234567890123456789012345678901234567890');
      expect(result).toEqual({
        dbps: 100,
        payee: '0x1234567890123456789012345678901234567890',
      });
    });

    test('should throw error for fee exceeding 100%', () => {
      expect(() => {
        executorService.generateFeeArgs(10001, '0x1234567890123456789012345678901234567890');
      }).toThrow('Fee cannot exceed 100% (10000 bps)');
    });

    test('should use default values', () => {
      const result = executorService.generateFeeArgs();
      expect(result).toEqual({
        dbps: 0,
        payee: '0x0000000000000000000000000000000000000000',
      });
    });
  });

  describe('generateRelayInstructions', () => {
    test('should generate relay instructions with default gas limit', () => {
      const result = executorService.generateRelayInstructions();
      expect(result).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });

    test('should generate relay instructions with custom gas limit', () => {
      const result = executorService.generateRelayInstructions(1000000);
      expect(result).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });

    test('should throw error for invalid gas limit', () => {
      expect(() => {
        executorService.generateRelayInstructions(0);
      }).toThrow('Gas limit must be greater than zero');
    });
  });

  describe('validateExecutorParameters', () => {
    test('should validate correct parameters', () => {
      const executorArgs = {
        value: '1000000000000000000',
        refundAddress: '0x1234567890123456789012345678901234567890',
        signedQuote: '0x' + 'a'.repeat(200),
        instructions: '0x01',
      };
      const feeArgs = {
        dbps: 100,
        payee: '0x1234567890123456789012345678901234567890',
      };

      expect(() => {
        executorService.validateExecutorParameters(executorArgs, feeArgs);
      }).not.toThrow();
    });

    test('should throw error for invalid signed quote', () => {
      const executorArgs = {
        value: '1000000000000000000',
        refundAddress: '0x1234567890123456789012345678901234567890',
        signedQuote: '0x',
        instructions: '0x01',
      };
      const feeArgs = {
        dbps: 100,
        payee: '0x1234567890123456789012345678901234567890',
      };

      expect(() => {
        executorService.validateExecutorParameters(executorArgs, feeArgs);
      }).toThrow('Invalid signed quote: too short or empty');
    });

    test('should throw error for invalid refund address', () => {
      const executorArgs = {
        value: '1000000000000000000',
        refundAddress: 'invalid-address',
        signedQuote: '0x' + 'a'.repeat(200),
        instructions: '0x01',
      };
      const feeArgs = {
        dbps: 100,
        payee: '0x1234567890123456789012345678901234567890',
      };

      expect(() => {
        executorService.validateExecutorParameters(executorArgs, feeArgs);
      }).toThrow('Invalid refund address');
    });

    test('should throw error for fee exceeding 100%', () => {
      const executorArgs = {
        value: '1000000000000000000',
        refundAddress: '0x1234567890123456789012345678901234567890',
        signedQuote: '0x' + 'a'.repeat(200),
        instructions: '0x01',
      };
      const feeArgs = {
        dbps: 10001,
        payee: '0x1234567890123456789012345678901234567890',
      };

      expect(() => {
        executorService.validateExecutorParameters(executorArgs, feeArgs);
      }).toThrow('Fee cannot exceed 100% (10000 bps)');
    });
  });

  describe('calculateTotalCost', () => {
    test('should calculate total cost correctly', () => {
      const result = executorService.calculateTotalCost('500000000000000000', '500000000000000000');
      expect(result).toBe('1000000000000000000');
    });

    test('should handle zero costs', () => {
      const result = executorService.calculateTotalCost('0', '0');
      expect(result).toBe('0');
    });
  });

  describe('formatCost', () => {
    test('should format cost correctly', () => {
      const result = executorService.formatCost('1000000000000000000');
      expect(result).toContain('1.0 ETH');
      expect(result).toContain('1000000000000000000 wei');
    });

    test('should format small costs', () => {
      const result = executorService.formatCost('1000000000000000');
      expect(result).toContain('0.001 ETH');
      expect(result).toContain('1000000000000000 wei');
    });
  });

  describe('constructor', () => {
    test('should use default values', () => {
      const service = new ExecutorService();
      expect(service).toBeInstanceOf(ExecutorService);
    });

    test('should use custom values', () => {
      const service = new ExecutorService('https://custom-api.com', 60000);
      expect(service).toBeInstanceOf(ExecutorService);
    });
  });
});