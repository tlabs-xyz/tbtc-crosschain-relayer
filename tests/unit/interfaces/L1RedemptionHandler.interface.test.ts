/**
 * Tests for L1RedemptionHandler.interface.ts
 *
 * These tests verify:
 * 1. L1RelayResult interface exists and exports correctly
 * 2. L1RelayResult has required fields with correct types
 * 3. L1RedemptionHandlerInterface method signature is updated
 */

import type { BigNumber } from 'ethers';
import type { AnyChainConfig } from '../../../config/index.js';
import type {
  L1RelayResult,
  L1RedemptionHandlerInterface,
} from '../../../interfaces/L1RedemptionHandler.interface.js';

/**
 * Test fixtures for L1RelayResult scenarios
 */
const TEST_TX_HASH = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const TEST_REDEEMER_OUTPUT_SCRIPT = '0x0014abcdef1234567890abcdef1234567890abcdef';

/**
 * Factory function to create L1RelayResult objects for testing
 */
function createL1RelayResult(overrides: Partial<L1RelayResult> = {}): L1RelayResult {
  return {
    success: false,
    isRetryable: false,
    ...overrides,
  };
}

describe('L1RedemptionHandler.interface', () => {
  describe('L1RelayResult', () => {
    it('should export L1RelayResult interface', () => {
      // This test verifies the interface can be imported
      // If L1RelayResult is not exported, TypeScript compilation fails
      const result = createL1RelayResult({ success: true });
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.isRetryable).toBe('boolean');
    });

    it('should have required success field as boolean', () => {
      const successResult = createL1RelayResult({ success: true });
      expect(successResult.success).toBe(true);

      const failResult = createL1RelayResult({ success: false, isRetryable: true });
      expect(failResult.success).toBe(false);
    });

    it('should have required isRetryable field as boolean', () => {
      const retryableResult = createL1RelayResult({ success: false, isRetryable: true });
      expect(retryableResult.isRetryable).toBe(true);

      const nonRetryableResult = createL1RelayResult({ success: false, isRetryable: false });
      expect(nonRetryableResult.isRetryable).toBe(false);
    });

    it('should have optional txHash field as string', () => {
      const withTxHash = createL1RelayResult({ success: true, txHash: TEST_TX_HASH });
      expect(withTxHash.txHash).toBe(TEST_TX_HASH);

      const withoutTxHash = createL1RelayResult({ success: false, isRetryable: true });
      expect(withoutTxHash.txHash).toBeUndefined();
    });

    it('should have optional error field as string', () => {
      const withError = createL1RelayResult({
        success: false,
        error: 'pending redemption collision detected',
        isRetryable: true,
      });
      expect(withError.error).toBe('pending redemption collision detected');

      const withoutError = createL1RelayResult({ success: true, txHash: '0xabc123' });
      expect(withoutError.error).toBeUndefined();
    });

    it('should accept valid success result object', () => {
      // Success case: transaction completed
      const successResult = createL1RelayResult({
        success: true,
        txHash: TEST_TX_HASH,
        isRetryable: false,
      });

      expect(successResult.success).toBe(true);
      expect(successResult.txHash).toBeDefined();
      expect(successResult.error).toBeUndefined();
      expect(successResult.isRetryable).toBe(false);
    });

    it('should accept valid retryable error result object', () => {
      // Retryable error case: pending redemption collision
      const retryableResult = createL1RelayResult({
        success: false,
        error: 'pending redemption',
        isRetryable: true,
      });

      expect(retryableResult.success).toBe(false);
      expect(retryableResult.txHash).toBeUndefined();
      expect(retryableResult.error).toBe('pending redemption');
      expect(retryableResult.isRetryable).toBe(true);
    });

    it('should accept valid permanent error result object', () => {
      // Permanent error case: VAA already used
      const permanentResult = createL1RelayResult({
        success: false,
        error: 'VAA was already executed',
        isRetryable: false,
      });

      expect(permanentResult.success).toBe(false);
      expect(permanentResult.txHash).toBeUndefined();
      expect(permanentResult.error).toBe('VAA was already executed');
      expect(permanentResult.isRetryable).toBe(false);
    });
  });

  describe('L1RedemptionHandlerInterface', () => {
    /**
     * Creates a mock L1RedemptionHandlerInterface for testing
     */
    function createMockHandler(
      relayImpl?: (
        amount: BigNumber,
        signedVaa: Uint8Array,
        l2ChainName: string,
        l2TransactionHash: string,
        redeemerOutputScript: string,
      ) => Promise<L1RelayResult>,
    ): L1RedemptionHandlerInterface {
      return {
        config: {} as AnyChainConfig,
        initialize: async () => {},
        relayRedemptionToL1:
          relayImpl ??
          (async () => createL1RelayResult({ success: true, txHash: '0x123', isRetryable: false })),
      };
    }

    it('should have relayRedemptionToL1 with updated signature accepting redeemerOutputScript', () => {
      // Create a mock implementation that satisfies the interface
      // This verifies the method signature accepts 5 parameters
      const mockHandler = createMockHandler(
        async (amount, signedVaa, l2ChainName, l2TransactionHash, redeemerOutputScript) => {
          // Verify all parameters are received
          expect(amount).toBeDefined();
          expect(signedVaa).toBeDefined();
          expect(l2ChainName).toBeDefined();
          expect(l2TransactionHash).toBeDefined();
          expect(redeemerOutputScript).toBeDefined();

          return createL1RelayResult({ success: true, txHash: '0x123' });
        },
      );

      expect(mockHandler.relayRedemptionToL1).toBeDefined();
      expect(typeof mockHandler.relayRedemptionToL1).toBe('function');
    });

    it('should return Promise<L1RelayResult> from relayRedemptionToL1', async () => {
      const expectedTxHash = '0xTestTxHash';
      const mockHandler = createMockHandler(async () =>
        createL1RelayResult({ success: true, txHash: expectedTxHash }),
      );

      // Call the method and verify return type
      const result = await mockHandler.relayRedemptionToL1(
        { _hex: '0x1000' } as unknown as BigNumber,
        new Uint8Array([1, 2, 3]),
        'ArbitrumSepolia',
        '0xL2TxHash',
        TEST_REDEEMER_OUTPUT_SCRIPT,
      );

      // Verify return type structure
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('isRetryable');
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.isRetryable).toBe('boolean');
      expect(result.txHash).toBe(expectedTxHash);
    });
  });
});
