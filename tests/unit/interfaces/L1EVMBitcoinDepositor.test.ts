/**
 * Tests for Wormhole ABI definitions used in the EVM bridging flow.
 *
 * Verifies:
 * 1. TokensTransferredWithPayload event in L1EVMBitcoinDepositor ABI
 * 2. L2WormholeGateway ABI with receiveTbtc function
 * 3. ethers.js Interface compatibility for both ABIs
 * 4. No existing ABI entries are broken by additions
 */

import { ethers } from 'ethers';
import { L1BitcoinDepositorABI } from '../../../interfaces/L1EVMBitcoinDepositor.js';
import { L2WormholeGatewayABI } from '../../../interfaces/L2WormholeGateway.js';

/** Sample encoded VAA bytes for receiveTbtc encoding test */
const SAMPLE_VAA_BYTES = '0xdeadbeef';

describe('Wormhole ABI Definitions', () => {
  describe('L1EVMBitcoinDepositor - TokensTransferredWithPayload event', () => {
    const tokensTransferredEvent = L1BitcoinDepositorABI.find(
      (entry) => entry.name === 'TokensTransferredWithPayload' && entry.type === 'event',
    );

    it('should contain TokensTransferredWithPayload event entry', () => {
      expect(tokensTransferredEvent).toBeDefined();
      expect(tokensTransferredEvent!.anonymous).toBe(false);
      expect(tokensTransferredEvent!.inputs).toHaveLength(3);
    });

    it('should have correct parameter types for EVM-specific variant', () => {
      expect(tokensTransferredEvent).toBeDefined();

      const inputs = tokensTransferredEvent!.inputs;

      // First input: amount (uint256)
      expect(inputs[0].name).toBe('amount');
      expect(inputs[0].type).toBe('uint256');
      expect(inputs[0].internalType).toBe('uint256');
      expect(inputs[0].indexed).toBe(false);

      // Second input: l2Receiver (address, NOT bytes32 -- EVM-specific)
      expect(inputs[1].name).toBe('l2Receiver');
      expect(inputs[1].type).toBe('address');
      expect(inputs[1].internalType).toBe('address');
      expect(inputs[1].indexed).toBe(false);

      // Third input: transferSequence (uint64)
      expect(inputs[2].name).toBe('transferSequence');
      expect(inputs[2].type).toBe('uint64');
      expect(inputs[2].internalType).toBe('uint64');
      expect(inputs[2].indexed).toBe(false);
    });

    it('should be parseable by ethers.js Interface', () => {
      const iface = new ethers.utils.Interface(L1BitcoinDepositorABI);

      const eventFragment = iface.getEvent('TokensTransferredWithPayload');

      expect(eventFragment).toBeDefined();
      expect(eventFragment.name).toBe('TokensTransferredWithPayload');
      expect(eventFragment.inputs).toHaveLength(3);
    });

    it('should not break any existing ABI entries', () => {
      const eventEntries = L1BitcoinDepositorABI.filter((entry) => entry.type === 'event');
      const functionEntries = L1BitcoinDepositorABI.filter((entry) => entry.type === 'function');

      // 9 original events + 1 new TokensTransferredWithPayload = 10
      expect(eventEntries).toHaveLength(10);

      // All original events still present
      const originalEventNames = [
        'DepositFinalized',
        'DepositInitialized',
        'GasOffsetParametersUpdated',
        'Initialized',
        'L2FinalizeDepositGasLimitUpdated',
        'OwnershipTransferred',
        'ReimburseTxMaxFeeUpdated',
        'ReimbursementAuthorizationUpdated',
        'ReimbursementPoolUpdated',
      ];

      for (const name of originalEventNames) {
        const found = eventEntries.find((e) => e.name === name);
        expect(found).toBeDefined();
      }

      // Function count unchanged (constructor + 26 functions = 27 total non-event entries)
      expect(functionEntries.length).toBeGreaterThanOrEqual(26);
    });
  });

  describe('L2WormholeGateway ABI', () => {
    it('should export L2WormholeGatewayABI with receiveTbtc function', () => {
      expect(L2WormholeGatewayABI).toBeDefined();
      expect(Array.isArray(L2WormholeGatewayABI)).toBe(true);

      const receiveTbtc = L2WormholeGatewayABI.find(
        (entry) => entry.name === 'receiveTbtc' && entry.type === 'function',
      );

      expect(receiveTbtc).toBeDefined();
      expect(receiveTbtc!.stateMutability).toBe('nonpayable');
      expect(receiveTbtc!.inputs).toHaveLength(1);
      expect(receiveTbtc!.inputs[0].name).toBe('encodedVm');
      expect(receiveTbtc!.inputs[0].type).toBe('bytes');
      expect(receiveTbtc!.inputs[0].internalType).toBe('bytes');
      expect(receiveTbtc!.outputs).toHaveLength(0);
    });

    it('should be encodable by ethers.js Interface', () => {
      const iface = new ethers.utils.Interface(L2WormholeGatewayABI);

      const encoded = iface.encodeFunctionData('receiveTbtc', [SAMPLE_VAA_BYTES]);

      expect(typeof encoded).toBe('string');
      expect(encoded.startsWith('0x')).toBe(true);
      // The function selector for receiveTbtc(bytes) should be present
      expect(encoded.length).toBeGreaterThan(10);
    });
  });
});
