import { ethers } from 'ethers';
import type { EvmChainConfig } from '../../config/schemas/evm.chain.schema.js';
import { CHAIN_TYPE, NETWORK } from '../../config/schemas/common.schema.js';
import {
  RedemptionStatus,
  type Redemption,
  type RedemptionRequestedEventData,
  type BitcoinTxUtxo,
} from '../../types/Redemption.type.js';
import { jest } from '@jest/globals';
import { toNative } from '@wormhole-foundation/sdk-connect';

/**
 * Shared test data factories for L2RedemptionService tests
 * Used across E2E, Integration, and Unit tests to avoid duplication
 */

export const createMockChainConfig = (overrides: Partial<EvmChainConfig> = {}): EvmChainConfig => ({
  chainType: CHAIN_TYPE.EVM,
  chainName: 'testChain',
  network: NETWORK.TESTNET,
  useEndpoint: false,
  supportsRevealDepositAPI: false,
  enableL2Redemption: true,
  l1Rpc: 'https://mock-l1-rpc.com',
  l2Rpc: 'https://mock-l2-rpc.com',
  l2WsRpc: 'wss://mock-l2-ws.com',
  l1ContractAddress: '0x1111111111111111111111111111111111111111',
  l2ContractAddress: '0x2222222222222222222222222222222222222222',
  l1BitcoinRedeemerAddress: '0x1234567890123456789012345678901234567890',
  l2BitcoinRedeemerAddress: '0x0987654321098765432109876543210987654321',
  l2WormholeChainId: 1001,
  l2WormholeGatewayAddress: '0xAABBCCDDEEFF0011223344556677889900112233',
  l2StartBlock: 1000000,
  vaultAddress: '0x3333333333333333333333333333333333333333',
  l1Confirmations: 12,
  ...overrides,
});

export const createMockBitcoinUtxo = (overrides: Partial<BitcoinTxUtxo> = {}): BitcoinTxUtxo => ({
  txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  txOutputIndex: 0,
  txOutputValue: '100000000', // 1 BTC in satoshis
  ...overrides,
});

export const createMockRedemptionEvent = (
  overrides: Partial<RedemptionRequestedEventData> = {},
): RedemptionRequestedEventData => ({
  walletPubKeyHash: '0x1234567890123456789012345678901234567890',
  mainUtxo: createMockBitcoinUtxo(),
  redeemerOutputScript: '0x76a914' + '12'.repeat(20) + '88ac', // P2PKH script
  amount: ethers.BigNumber.from('50000000'), // 0.5 BTC
  l2TransactionHash: '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
  ...overrides,
});

export const createMockRedemption = (
  status: RedemptionStatus = RedemptionStatus.PENDING,
  overrides: Partial<Redemption> = {},
): Redemption => {
  const now = Date.now();
  const baseRedemption: Redemption = {
    id: 'test-redemption-id-' + status,
    chainId: 'testChain',
    event: createMockRedemptionEvent(),
    vaaBytes: null,
    vaaStatus: status,
    l1SubmissionTxHash: null,
    status,
    error: null,
    dates: {
      createdAt: now - 3600000, // 1 hour ago
      vaaFetchedAt: null,
      l1SubmittedAt: null,
      completedAt: null,
      lastActivityAt: now,
    },
    logs: [`Redemption created at ${new Date(now - 3600000).toISOString()}`],
  };

  // Set appropriate fields based on status
  switch (status) {
    case RedemptionStatus.VAA_FETCHED:
      baseRedemption.vaaBytes = '0x' + '12'.repeat(200); // Mock VAA bytes
      baseRedemption.dates.vaaFetchedAt = now - 1800000; // 30 min ago
      baseRedemption.logs!.push(`VAA fetched at ${new Date(now - 1800000).toISOString()}`);
      break;
    case RedemptionStatus.COMPLETED:
      baseRedemption.vaaBytes = '0x' + '12'.repeat(200);
      baseRedemption.l1SubmissionTxHash = '0x' + 'ab'.repeat(32);
      baseRedemption.dates.vaaFetchedAt = now - 1800000;
      baseRedemption.dates.l1SubmittedAt = now - 900000; // 15 min ago
      baseRedemption.dates.completedAt = now - 900000;
      baseRedemption.logs!.push(`VAA fetched at ${new Date(now - 1800000).toISOString()}`);
      baseRedemption.logs!.push(
        `L1 submission succeeded at ${new Date(now - 900000).toISOString()}`,
      );
      break;
    case RedemptionStatus.VAA_FAILED:
      baseRedemption.error = 'VAA fetch failed';
      baseRedemption.logs!.push(`VAA fetch failed at ${new Date(now).toISOString()}`);
      break;
    case RedemptionStatus.FAILED:
      baseRedemption.error = 'L1 submission failed';
      baseRedemption.vaaBytes = '0x' + '12'.repeat(200);
      baseRedemption.dates.vaaFetchedAt = now - 1800000;
      baseRedemption.logs!.push(`VAA fetched at ${new Date(now - 1800000).toISOString()}`);
      baseRedemption.logs!.push(`L1 submission failed at ${new Date(now).toISOString()}`);
      break;
  }

  return {
    ...baseRedemption,
    ...overrides,
  };
};

export const createMockVaaResponse = (valid = true) => {
  if (!valid) {
    return null;
  }

  // Create a mock VAA bytes array
  const mockVaaBytes = new Uint8Array(Buffer.from('12'.repeat(200), 'hex'));

  // Create UniversalAddress for emitter
  const emitterAddress = '0xAABBCCDDEEFF0011223344556677889900112233';
  const emitterUniversalAddress = toNative('Ethereum', emitterAddress).toUniversalAddress();

  // Mock parsed VAA that satisfies the ParsedVaaWithPayload (VAA<'TokenBridge:TransferWithPayload'>) type
  const mockParsedVaa = {
    // Required VAA properties
    version: 1,
    guardianSet: 0,
    signatures: [],
    timestamp: Math.floor(Date.now() / 1000), // Unix timestamp in seconds
    nonce: 1,
    emitterChain: 'Ethereum' as const,
    emitterAddress: emitterUniversalAddress,
    sequence: BigInt(123),
    consistencyLevel: 1,

    // Required protocol properties
    protocolName: 'TokenBridge' as const,
    payloadName: 'TransferWithPayload' as const,
    payloadLiteral: 'TokenBridge:TransferWithPayload' as const,

    // Mock payload data with correct structure for TokenBridge:TransferWithPayload
    payload: {
      token: {
        amount: BigInt('1000000000000000000'), // 1 ETH in wei
        address: emitterUniversalAddress,
        chain: 'Ethereum' as const,
      },
      to: {
        address: emitterUniversalAddress,
        chain: 'Ethereum' as const,
      },
      from: emitterUniversalAddress,
      payload: new Uint8Array(0),
    },

    // Hash of the VAA content
    hash: new Uint8Array([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
      27, 28, 29, 30, 31, 32,
    ]),

    // Serialize function
    serialize: jest.fn(() => mockVaaBytes),

    // VAA bytes (optional but can be included)
    bytes: mockVaaBytes,
  };

  return {
    vaaBytes: mockVaaBytes,
    parsedVaa: mockParsedVaa,
  };
};

export const createMockEthersEvent = (overrides: Partial<ethers.Event> = {}): ethers.Event => {
  const baseEvent = {
    transactionHash: '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
    blockNumber: 1000000,
    blockHash: '0x' + 'aa'.repeat(32),
    logIndex: 0,
    transactionIndex: 0,
    address: '0x0987654321098765432109876543210987654321',
    data: '0x',
    topics: [],
    args: [],
    decode: jest.fn(),
    event: 'RedemptionRequested',
    eventSignature: 'RedemptionRequested(bytes20,tuple,bytes,uint64)',
    ...overrides,
  } as unknown as ethers.Event;

  return baseEvent;
};

// Helper to create multiple test redemptions with different statuses
export const createMockRedemptionBatch = (
  count: number,
  baseStatus: RedemptionStatus = RedemptionStatus.PENDING,
): Redemption[] => {
  return Array.from({ length: count }, (_, index) =>
    createMockRedemption(baseStatus, {
      id: `test-redemption-${baseStatus}-${index}`,
      chainId: 'testChain',
    }),
  );
};

// Mock providers and contracts for testing
export const createMockProvider = () => ({
  getTransactionReceipt: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
  removeAllListeners: jest.fn(),
});

export const createMockContract = () => ({
  address: '0x0987654321098765432109876543210987654321',
  interface: {
    events: {
      RedemptionRequested: true,
    },
  },
  on: jest.fn(),
  removeAllListeners: jest.fn(),
});
