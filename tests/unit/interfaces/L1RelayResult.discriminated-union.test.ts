/**
 * Tests for L1RelayResult Discriminated Union Type Enhancement
 *
 * These tests verify the discriminated union pattern for L1RelayResult:
 * - Success case: success: true, txHash required, isRetryable: false, no error
 * - Failure case: success: false, error required, isRetryable: boolean, txHash optional
 *
 * The discriminated union enforces at compile-time that:
 * 1. Error field is ALWAYS present when success is false
 * 2. txHash field is ALWAYS present when success is true
 * 3. Type narrowing works correctly based on success value
 */

import type { L1RelayResult } from '../../../interfaces/L1RedemptionHandler.interface.js';

// Test constants
const TEST_TX_HASH = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const TEST_ERROR_MESSAGE = 'pending redemption collision detected';

/**
 * Factory function to create a valid success L1RelayResult.
 * Returns L1RelaySuccess variant of the discriminated union.
 */
function createL1RelaySuccess(txHash: string): L1RelayResult {
  return {
    success: true,
    txHash,
    isRetryable: false,
  };
}

/**
 * Factory function to create a valid failure L1RelayResult.
 * Returns L1RelayFailure variant of the discriminated union.
 */
function createL1RelayFailure(error: string, isRetryable: boolean): L1RelayResult {
  return {
    success: false,
    error,
    isRetryable,
  };
}

describe('L1RelayResult Discriminated Union', () => {
  /**
   * These tests verify that the discriminated union is now implemented correctly.
   * With the discriminated union (L1RelaySuccess | L1RelayFailure):
   * - error field is required on failure (error: string in L1RelayFailure)
   * - TypeScript enforces error at compile time for failure cases
   * - After narrowing with !success check, error is guaranteed string
   *
   * Note: Runtime tests can still create invalid objects (JavaScript has no runtime type checking),
   * but TypeScript compilation will catch invalid usage at build time.
   */
  describe('Discriminated Union Implementation Verification (GREEN Phase)', () => {
    it('should enforce error field presence on failure through TypeScript compilation', () => {
      // With discriminated union implemented, this test verifies the pattern works correctly.
      // Creating a proper failure result requires the error field.
      const failureWithError = createL1RelayFailure('test error', true);

      expect(failureWithError.success).toBe(false);
      expect(failureWithError.error).toBe('test error');
      expect(failureWithError.isRetryable).toBe(true);
    });

    it('should allow direct error access after type narrowing without nullish coalescing', () => {
      // This test verifies the key improvement: after checking !success,
      // error is directly accessible without defensive ?? operators
      const l1Result = createL1RelayFailure('L1 relay failed', true);

      if (!l1Result.success) {
        // With discriminated union, error is guaranteed string after narrowing
        // L2RedemptionService.ts lines 269 and 281 can now use direct access:
        // redemption.error = l1Result.error; (no ?? needed)
        const redemptionError: string = l1Result.error;
        expect(redemptionError).toBe('L1 relay failed');
        expect(typeof redemptionError).toBe('string');
      }
    });

    it('should guarantee error is string type after !success narrowing', () => {
      // This test verifies the discriminated union type narrowing behavior
      const result = createL1RelayFailure('permanent error', false);

      if (!result.success) {
        // With discriminated union, TypeScript knows error is string (not string | undefined)
        // This enables direct property access without optional chaining
        const errorLength: number = result.error.length;
        expect(errorLength).toBeGreaterThan(0);
        expect(result.error).toBe('permanent error');
      }
    });
  });

  describe('Type Export Verification', () => {
    it('should export L1RelayResult type that accepts success variant', () => {
      const successResult = createL1RelaySuccess(TEST_TX_HASH);

      expect(successResult).toBeDefined();
      expect(successResult.success).toBe(true);
      expect(successResult.txHash).toBe(TEST_TX_HASH);
      expect(successResult.isRetryable).toBe(false);
    });

    it('should export L1RelayResult type that accepts failure variant', () => {
      const failureResult = createL1RelayFailure(TEST_ERROR_MESSAGE, true);

      expect(failureResult).toBeDefined();
      expect(failureResult.success).toBe(false);
      expect(failureResult.error).toBe(TEST_ERROR_MESSAGE);
      expect(failureResult.isRetryable).toBe(true);
    });
  });

  describe('Success Case Type Narrowing', () => {
    it('should have txHash as string (not undefined) when success is true', () => {
      const result = createL1RelaySuccess(TEST_TX_HASH);

      // After checking success, TypeScript narrows the type to L1RelaySuccess
      if (result.success) {
        // With discriminated union, TypeScript guarantees txHash is string
        // No type assertion needed - direct access is type-safe
        const txHashValue: string = result.txHash;
        expect(txHashValue).toBe(TEST_TX_HASH);
        expect(typeof txHashValue).toBe('string');
      }
    });

    it('should enforce isRetryable is false for success case', () => {
      const result = createL1RelaySuccess(TEST_TX_HASH);

      if (result.success) {
        // With discriminated union, isRetryable should be literal type `false`
        // not just boolean for success cases
        expect(result.isRetryable).toBe(false);
      }
    });

    it('should not have error field defined on success case', () => {
      const result = createL1RelaySuccess(TEST_TX_HASH);

      if (result.success) {
        // Success case should not have error field
        // With discriminated union, accessing error would be a type error
        // For runtime test, we verify it's undefined
        expect(result.error).toBeUndefined();
      }
    });
  });

  describe('Failure Case Type Narrowing', () => {
    it('should have error as string (not undefined) when success is false', () => {
      const result = createL1RelayFailure(TEST_ERROR_MESSAGE, true);

      // After checking !success, TypeScript narrows the type to L1RelayFailure
      if (!result.success) {
        // With discriminated union, TypeScript guarantees error is string
        // No type assertion needed - direct access is type-safe
        const errorValue: string = result.error;
        expect(errorValue).toBe(TEST_ERROR_MESSAGE);
        expect(typeof errorValue).toBe('string');
      }
    });

    it('should allow isRetryable to be true or false for failure case', () => {
      const retryableFailure = createL1RelayFailure('retryable error', true);
      const permanentFailure = createL1RelayFailure('permanent error', false);

      if (!retryableFailure.success) {
        expect(retryableFailure.isRetryable).toBe(true);
      }

      if (!permanentFailure.success) {
        expect(permanentFailure.isRetryable).toBe(false);
      }
    });

    it('should allow optional txHash on failure case (for reverted transactions)', () => {
      // Some failures may have a txHash (e.g., on-chain revert)
      const failureWithTxHash: L1RelayResult = {
        success: false,
        error: 'transaction reverted',
        isRetryable: false,
        txHash: '0xrevertedtxhash',
      };

      if (!failureWithTxHash.success) {
        expect(failureWithTxHash.error).toBe('transaction reverted');
        // txHash can be present on failure (optional)
        expect(failureWithTxHash.txHash).toBe('0xrevertedtxhash');
      }
    });
  });

  describe('Error Field Enforcement on Failure', () => {
    it('should require error field to be defined on all failure results', () => {
      // Create various failure scenarios and verify error is always defined
      const scenarios = [
        { error: 'pending redemption', isRetryable: true },
        { error: 'VAA was already executed', isRetryable: false },
        { error: 'insufficient funds', isRetryable: false },
        { error: 'network error', isRetryable: true },
      ];

      for (const scenario of scenarios) {
        const result = createL1RelayFailure(scenario.error, scenario.isRetryable);

        // The critical assertion: error must be defined for all failure cases
        // With discriminated union, TypeScript enforces this at compile time
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(typeof result.error).toBe('string');
        expect(result.error).toBe(scenario.error);
      }
    });

    it('should have error accessible directly without nullish coalescing after type narrowing', () => {
      const result = createL1RelayFailure('test error', false);

      if (!result.success) {
        // This is the behavior that L2RedemptionService.ts needs:
        // After checking !success, error should be directly accessible as string
        // without needing ?? fallback
        //
        // Current code (line 269): redemption.error = l1Result.error ?? 'L1 relay failed (retryable)';
        // Should become:           redemption.error = l1Result.error;
        const errorMessage = result.error; // Should work without ?? after discriminated union
        expect(errorMessage).toBe('test error');
      }
    });
  });

  describe('Integration with L2RedemptionService Pattern', () => {
    /**
     * This test simulates the usage pattern in L2RedemptionService.processVaaFetchedRedemptions.
     * With discriminated union, the defensive ?? operators should be unnecessary.
     */
    it('should support direct error access pattern used in L2RedemptionService', () => {
      const retryableResult = createL1RelayFailure('pending redemption collision', true);
      const permanentResult = createL1RelayFailure('VAA was already executed', false);

      // Simulate L2RedemptionService logic
      const processResult = (l1Result: L1RelayResult): string | null => {
        if (l1Result.success && l1Result.txHash) {
          return null; // Success - no error
        } else if (l1Result.isRetryable) {
          // Current code: l1Result.error ?? 'L1 relay failed (retryable)'
          // With discriminated union, this becomes: l1Result.error
          if (!l1Result.success) {
            return l1Result.error; // Should be guaranteed string
          }
        } else {
          // Current code: l1Result.error ?? 'L1 submission failed (see logs for details)'
          // With discriminated union, this becomes: l1Result.error
          if (!l1Result.success) {
            return l1Result.error; // Should be guaranteed string
          }
        }
        return null;
      };

      expect(processResult(retryableResult)).toBe('pending redemption collision');
      expect(processResult(permanentResult)).toBe('VAA was already executed');
    });
  });

  describe('Success Case Constraints', () => {
    it('should enforce txHash is present on success', () => {
      const successResult = createL1RelaySuccess(TEST_TX_HASH);

      expect(successResult.success).toBe(true);
      // txHash must be present and be a valid string
      expect(successResult.txHash).toBeDefined();
      expect(typeof successResult.txHash).toBe('string');
      expect(successResult.txHash?.length).toBeGreaterThan(0);
    });

    it('should enforce isRetryable is false on success', () => {
      const successResult = createL1RelaySuccess(TEST_TX_HASH);

      // Success case should never be retryable
      expect(successResult.success).toBe(true);
      expect(successResult.isRetryable).toBe(false);
    });
  });
});
