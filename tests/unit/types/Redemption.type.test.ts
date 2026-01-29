/**
 * Unit tests for Redemption type definition
 *
 * These tests verify that the Redemption type includes an optional retryCount field
 * for tracking retry attempts during collision error handling.
 */
import { Redemption, RedemptionStatus } from '../../../types/Redemption.type.js';

describe('Redemption Type', () => {
  /**
   * Creates a valid base Redemption object with all required fields.
   * The retryCount field is intentionally typed to test optional field behavior.
   */
  const createBaseRedemption = (): Omit<Redemption, 'retryCount'> => ({
    id: 'test-redemption-id',
    chainId: '8453',
    event: {
      redeemerOutputScript: '0x0014abcdef1234567890abcdef1234567890abcdef12',
      amount: '1000000000000000000',
      l2TransactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    },
    serializedVaaBytes: null,
    vaaStatus: RedemptionStatus.PENDING,
    l1SubmissionTxHash: null,
    status: RedemptionStatus.PENDING,
    error: null,
    dates: {
      createdAt: Date.now(),
      vaaFetchedAt: null,
      l1SubmittedAt: null,
      completedAt: null,
      lastActivityAt: Date.now(),
    },
    logs: [],
  });

  describe('retryCount field', () => {
    it('should accept retryCount with a number value', () => {
      // This test verifies that retryCount can be set to a positive number
      const redemption: Redemption = { ...createBaseRedemption(), retryCount: 5 };
      expect(redemption.retryCount).toBe(5);
    });

    it('should allow omitting retryCount (backward compatibility)', () => {
      // This test verifies backward compatibility - existing records without retryCount should still be valid
      const redemption: Redemption = createBaseRedemption();
      expect(redemption.retryCount).toBeUndefined();
    });

    it('should accept retryCount with zero value', () => {
      // Zero is a valid value indicating no retries have occurred
      const redemption: Redemption = { ...createBaseRedemption(), retryCount: 0 };
      expect(redemption.retryCount).toBe(0);
    });

    it('should accept retryCount with positive integers', () => {
      // Various positive integer values should be accepted
      const redemption1: Redemption = { ...createBaseRedemption(), retryCount: 1 };
      const redemption10: Redemption = { ...createBaseRedemption(), retryCount: 10 };

      expect(redemption1.retryCount).toBe(1);
      expect(redemption10.retryCount).toBe(10);
    });

    it('should accept retryCount as undefined explicitly', () => {
      // Explicitly setting undefined should be valid for optional field
      const redemption: Redemption = { ...createBaseRedemption(), retryCount: undefined };
      expect(redemption.retryCount).toBeUndefined();
    });
  });

  describe('backward compatibility', () => {
    it('should maintain all existing fields', () => {
      // Verify that existing fields are still properly typed
      const redemption: Redemption = createBaseRedemption();

      expect(typeof redemption.id).toBe('string');
      expect(typeof redemption.chainId).toBe('string');
      expect(redemption.event).toBeDefined();
      expect(redemption.dates).toBeDefined();
      expect(Array.isArray(redemption.logs)).toBe(true);
    });

    it('should maintain existing optional fields', () => {
      // Verify that existing optional fields (logs) work correctly
      const redemptionWithLogs: Redemption = {
        ...createBaseRedemption(),
        logs: ['log entry 1', 'log entry 2'],
      };

      expect(redemptionWithLogs.logs).toHaveLength(2);
    });
  });
});
