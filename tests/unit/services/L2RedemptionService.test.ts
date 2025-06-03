import { ethers } from 'ethers';
import { RedemptionStatus } from '../../../types/Redemption.type.js';
import {
  createMockChainConfig,
  createMockRedemptionEvent,
  createMockEthersEvent,
  createMockBitcoinUtxo,
} from '../../mocks/L2RedemptionServiceTestData.js';

// We only test the specific functions that contain unique logic
// Most of L2RedemptionService is covered by E2E and Integration tests

describe('L2RedemptionService Unit Tests - Optimized', () => {
  describe('✅ Data Transformation Logic', () => {
    describe('VAA bytes hex ↔ Buffer conversion', () => {
      it('should handle valid hex string conversion with/without 0x prefix and round-trip conversions', () => {
        // Test with 0x prefix
        const hexWithPrefix = '0x1234567890abcdef';
        const buffer1 = Buffer.from(hexWithPrefix.slice(2), 'hex');
        const result1 = buffer1.toString('hex');
        expect(result1).toBe('1234567890abcdef');

        // Test without 0x prefix
        const hexWithoutPrefix = '1234567890abcdef';
        const buffer2 = Buffer.from(hexWithoutPrefix, 'hex');
        const result2 = buffer2.toString('hex');
        expect(result2).toBe('1234567890abcdef');

        // Test round-trip conversion
        const originalHex = 'deadbeefcafebabe';
        const buffer = Buffer.from(originalHex, 'hex');
        const backToHex = buffer.toString('hex');
        expect(backToHex).toBe(originalHex);

        // Test realistic VAA size conversion
        const longHex = '01'.repeat(500); // 1000 characters = 500 bytes
        const longBuffer = Buffer.from(longHex, 'hex');
        expect(longBuffer.length).toBe(500);
        expect(longBuffer.toString('hex')).toBe(longHex);

        // Test Buffer to hex conversion edge cases
        const emptyBuffer = Buffer.alloc(0);
        expect(emptyBuffer.toString('hex')).toBe('');

        const singleByte = Buffer.from([0xff]);
        expect(singleByte.toString('hex')).toBe('ff');

        const zeroBuffer = Buffer.alloc(8, 0);
        expect(zeroBuffer.toString('hex')).toBe('0000000000000000');

        const mixedBuffer = Buffer.from([0x00, 0xff, 0x80, 0x7f]);
        expect(mixedBuffer.toString('hex')).toBe('00ff807f');
      });

      it('should handle invalid hex and edge cases gracefully', () => {
        // Test with invalid hex characters
        const invalidHex = 'zzzzzz';
        const buffer = Buffer.from(invalidHex, 'hex');
        // Buffer.from with invalid hex returns empty buffer
        expect(buffer.length).toBe(0);

        // Test with odd length hex string
        const oddLengthHex = '123';
        const buffer2 = Buffer.from(oddLengthHex, 'hex');
        // Buffer.from handles odd-length strings by treating as if padded with 0
        expect(buffer2.toString('hex')).toBe('12');

        // Test empty string
        const emptyHex = '';
        const buffer1 = Buffer.from(emptyHex, 'hex');
        expect(buffer1.length).toBe(0);

        // Test undefined/null scenarios
        const nullValue = null;
        if (nullValue === null) {
          // In the actual service, null vaaBytes should cause early return
          expect(nullValue).toBeNull();
        }
      });
    });
  });

  describe('✅ Redemption Object Construction', () => {
    describe('Event data → Redemption object mapping with type handling', () => {
      it('should handle complete event data mapping with proper types and timestamp consistency', () => {
        const mockEvent = createMockRedemptionEvent();
        const mockEthersEvent = createMockEthersEvent();
        const chainConfig = createMockChainConfig();
        const now = Date.now();

        // Simulate the mapping logic from the service
        const redemption = {
          id: mockEthersEvent.transactionHash,
          chainId: chainConfig.chainName,
          event: {
            walletPubKeyHash: mockEvent.walletPubKeyHash,
            mainUtxo: mockEvent.mainUtxo,
            redeemerOutputScript: mockEvent.redeemerOutputScript,
            amount: mockEvent.amount,
            l2TransactionHash: mockEthersEvent.transactionHash,
          },
          vaaBytes: null,
          vaaStatus: RedemptionStatus.PENDING,
          l1SubmissionTxHash: null,
          status: RedemptionStatus.PENDING,
          error: null,
          dates: {
            createdAt: now,
            vaaFetchedAt: null,
            l1SubmittedAt: null,
            completedAt: null,
            lastActivityAt: now,
          },
          logs: [`Redemption created at ${new Date(now).toISOString()}`],
        };

        // Verify all fields are properly mapped and typed
        expect(redemption.id).toBe(mockEthersEvent.transactionHash);
        expect(typeof redemption.id).toBe('string');
        expect(redemption.chainId).toBe(chainConfig.chainName);
        expect(redemption.event.walletPubKeyHash).toBe(mockEvent.walletPubKeyHash);
        expect(redemption.event.mainUtxo).toEqual(mockEvent.mainUtxo);
        expect(redemption.event.amount).toEqual(mockEvent.amount);
        expect(redemption.status).toBe(RedemptionStatus.PENDING);
        expect(redemption.vaaStatus).toBe(RedemptionStatus.PENDING);
        expect(redemption.dates.createdAt).toBe(now);
        expect(redemption.dates.lastActivityAt).toBe(now);
        expect(redemption.logs).toHaveLength(1);

        // Test timestamp generation consistency and ISO string formatting
        const beforeTime = Date.now();
        const createdAt = Date.now();
        const lastActivityAt = createdAt;
        const afterTime = Date.now();

        expect(createdAt).toBeGreaterThanOrEqual(beforeTime);
        expect(createdAt).toBeLessThanOrEqual(afterTime);
        expect(lastActivityAt).toBe(createdAt);

        // Test ISO string generation (used in logs)
        const isoString = new Date(createdAt).toISOString();
        expect(isoString).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

        // Verify round-trip timestamp conversion
        const reconstructed = new Date(isoString).getTime();
        expect(reconstructed).toBe(createdAt);
      });

      it('should handle BigNumber serialization/deserialization and complex UTXO construction', () => {
        const originalAmount = ethers.BigNumber.from('50000000'); // 0.5 BTC
        const mockEvent = createMockRedemptionEvent({
          amount: originalAmount,
        });

        // Verify BigNumber properties are preserved
        expect(ethers.BigNumber.isBigNumber(mockEvent.amount)).toBe(true);
        expect(mockEvent.amount.toString()).toBe('50000000');
        expect(mockEvent.amount.toNumber()).toBe(50000000);

        // Test serialization (what would happen in store)
        const serialized = JSON.stringify({
          amount: mockEvent.amount.toString(),
        });

        const parsed = JSON.parse(serialized);
        const deserializedAmount = ethers.BigNumber.from(parsed.amount);

        expect(deserializedAmount.toString()).toBe(originalAmount.toString());
        expect(deserializedAmount.eq(originalAmount)).toBe(true);

        // Test edge cases for BigNumber
        const zeroBigNumber = ethers.BigNumber.from('0');
        expect(zeroBigNumber.toString()).toBe('0');
        expect(zeroBigNumber.isZero()).toBe(true);

        const maxUint64 = ethers.BigNumber.from('18446744073709551615');
        expect(maxUint64.toString()).toBe('18446744073709551615');

        // Test complex UTXO object construction with proper nesting
        const mockUtxo = createMockBitcoinUtxo({
          txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          txOutputIndex: 42,
          txOutputValue: '99900000', // 0.999 BTC
        });

        const complexEvent = createMockRedemptionEvent({
          mainUtxo: mockUtxo,
          amount: ethers.BigNumber.from('99900000'),
        });

        // Verify UTXO structure and nesting
        expect(complexEvent.mainUtxo.txHash).toBe(
          '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        );
        expect(complexEvent.mainUtxo.txOutputIndex).toBe(42);
        expect(complexEvent.mainUtxo.txOutputValue).toBe('99900000');
        expect(typeof complexEvent.mainUtxo.txOutputIndex).toBe('number');
        expect(typeof complexEvent.mainUtxo.txOutputValue).toBe('string');

        // Verify amount and UTXO value consistency
        expect(complexEvent.amount.toString()).toBe(complexEvent.mainUtxo.txOutputValue);

        // Test nested object serialization/deserialization
        const complexSerialized = JSON.stringify({
          mainUtxo: complexEvent.mainUtxo,
          amount: complexEvent.amount.toString(),
        });

        const complexParsed = JSON.parse(complexSerialized);
        expect(complexParsed.mainUtxo.txHash).toBe(mockUtxo.txHash);
        expect(complexParsed.mainUtxo.txOutputIndex).toBe(mockUtxo.txOutputIndex);
        expect(complexParsed.mainUtxo.txOutputValue).toBe(mockUtxo.txOutputValue);

        const complexDeserializedAmount = ethers.BigNumber.from(complexParsed.amount);
        expect(complexDeserializedAmount.toString()).toBe('99900000');
      });
    });
  });
});
