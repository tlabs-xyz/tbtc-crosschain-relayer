import { Deposit } from '../../../types/Deposit.type.js';
import { DepositStatus } from '../../../types/DepositStatus.enum.js';
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import * as JsonUtils from '../../../utils/JsonUtils';

    const testDeposit: Deposit = {
  id: 'test-id',
  fundingTxHash: '0xfundingtxhash',
      outputIndex: 0,
  hashes: { btc: { btcTxHash: '0xbtc' }, eth: { initializeTxHash: null, finalizeTxHash: null } },
      receipt: {
    depositor: '0xdepositor',
    blindingFactor: '0xblinding',
    walletPublicKeyHash: '0xwallet',
    refundPublicKeyHash: '0xrefund',
    refundLocktime: '0xlock',
    extraData: '0xextra',
  },
  owner: '0xowner',
      status: DepositStatus.QUEUED,
      L1OutputEvent: { 
    fundingTx: {
      version: '1',
      inputVector: 'input',
      outputVector: 'output',
      locktime: '0',
    },
    reveal: [0, 'blinding', 'wallet', 'refund', 'lock', 'extra'],
    l2DepositOwner: '0xowner',
    l2Sender: '0xsender',
      },
      dates: {
    createdAt: Date.now(),
        initializationAt: null,
        finalizationAt: null,
    lastActivityAt: Date.now(),
      },
      error: null,
    };

describe('JsonUtils (DB-backed)', () => {
  beforeEach(async () => {
    // Clean DB before each test
    const all = await JsonUtils.getAllJsonOperations();
    for (const d of all) {
      await JsonUtils.deleteJson(d.id);
    }
  });

  test('isEmptyJson returns true for empty object', () => {
    expect(JsonUtils.isEmptyJson({} as any)).toBe(true);
  });

  test('isValidJson returns true for valid JSON string', () => {
    expect(JsonUtils.isValidJson('{"a":1}')).toBe(true);
  });

  test('writeJson and getJsonById roundtrip', async () => {
    await JsonUtils.writeJson(testDeposit, testDeposit.id);
    const result = await JsonUtils.getJsonById(testDeposit.id);
    expect(result).toBeTruthy();
    expect(result?.id).toBe(testDeposit.id);
  });

  test('getJsonById returns null for non-existent id', async () => {
    const result = await JsonUtils.getJsonById('non-existent');
    expect(result).toBeNull();
  });

  test('deleteJson removes deposit', async () => {
    await JsonUtils.writeJson(testDeposit, testDeposit.id);
    const deleted = await JsonUtils.deleteJson(testDeposit.id);
    expect(deleted).toBe(true);
    const result = await JsonUtils.getJsonById(testDeposit.id);
    expect(result).toBeNull();
  });

  test('deleteJson returns false for non-existent id', async () => {
    const deleted = await JsonUtils.deleteJson('non-existent');
    expect(deleted).toBe(false);
  });

  test('getAllJsonOperations returns all deposits', async () => {
    await JsonUtils.writeJson(testDeposit, testDeposit.id);
    const all = await JsonUtils.getAllJsonOperations();
    expect(all.length).toBe(1);
    expect(all[0].id).toBe(testDeposit.id);
  });

  test('getAllJsonOperationsByStatus returns correct deposits', async () => {
    await JsonUtils.writeJson(testDeposit, testDeposit.id);
    const byStatus = await JsonUtils.getAllJsonOperationsByStatus(DepositStatus.QUEUED);
    expect(byStatus.length).toBe(1);
    expect(byStatus[0].id).toBe(testDeposit.id);
    const none = await JsonUtils.getAllJsonOperationsByStatus(DepositStatus.FINALIZED);
    expect(none.length).toBe(0);
  });
});
