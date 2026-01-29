import { ethers } from 'ethers';
import {
  RedemptionStatus,
  type Redemption,
  type RedemptionRequestedEventData,
} from '../../../types/Redemption.type.js';
import type {
  L1RelayResult,
  L1RedemptionHandlerInterface,
} from '../../../interfaces/L1RedemptionHandler.interface.js';
import type { EvmChainConfig } from '../../../config/schemas/evm.chain.schema.js';

// Mock the Logger module to prevent console output during tests
jest.mock('../../../utils/Logger.js', () => ({
  __esModule: true,
  default: {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  },
  logErrorContext: jest.fn(),
}));

// Mock RedemptionStore
const mockRedemptionStoreUpdate = jest.fn();
const mockRedemptionStoreGetByStatus = jest.fn();
const mockRedemptionStoreGetById = jest.fn();
const mockRedemptionStoreCreate = jest.fn();

jest.mock('../../../utils/RedemptionStore.js', () => ({
  RedemptionStore: {
    update: (...args: unknown[]) => mockRedemptionStoreUpdate(...args),
    getByStatus: (...args: unknown[]) => mockRedemptionStoreGetByStatus(...args),
    getById: (...args: unknown[]) => mockRedemptionStoreGetById(...args),
    create: (...args: unknown[]) => mockRedemptionStoreCreate(...args),
  },
}));

// Mock L1RedemptionHandler registry
const mockRelayRedemptionToL1 = jest.fn();
const mockHandlerInitialize = jest.fn();

jest.mock('../../../handlers/L1RedemptionHandlerRegistry.js', () => ({
  l1RedemptionHandlerRegistry: {
    get: jest.fn(() => ({
      config: {} as EvmChainConfig,
      initialize: mockHandlerInitialize,
      relayRedemptionToL1: mockRelayRedemptionToL1,
    })),
  },
}));

// Mock WormholeVaaService
jest.mock('../../../services/WormholeVaaService.js', () => ({
  WormholeVaaService: {
    create: jest.fn().mockResolvedValue({
      fetchVaaForRedemption: jest.fn(),
    }),
  },
}));

// Mock ethers provider
jest.mock('ethers', () => {
  const actualEthers = jest.requireActual('ethers');
  return {
    ...actualEthers,
    ethers: {
      ...actualEthers.ethers,
      providers: {
        JsonRpcProvider: jest.fn().mockImplementation(() => ({
          getBlockNumber: jest.fn().mockResolvedValue(1000),
          getBlock: jest.fn().mockResolvedValue({ timestamp: 1700000000 }),
          on: jest.fn(),
        })),
      },
      Contract: jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        removeAllListeners: jest.fn(),
        queryFilter: jest.fn().mockResolvedValue([]),
        filters: {
          RedemptionRequestedOnL2: jest.fn(),
        },
      })),
      BigNumber: actualEthers.BigNumber,
    },
  };
});

import { L2RedemptionService } from '../../../services/L2RedemptionService.js';
import { NETWORK, CHAIN_TYPE } from '../../../config/schemas/common.schema.js';

/**
 * Test suite for L2RedemptionService.processVaaFetchedRedemptions method.
 * Tests the retry logic branches, retryCount increment, max retry enforcement,
 * and redeemerOutputScript passing to handler.
 */
describe('L2RedemptionService', () => {
  let service: L2RedemptionService;
  let mockChainConfig: EvmChainConfig;

  // Helper to create a mock redemption with sensible defaults
  const createMockRedemption = (overrides: Partial<Redemption> = {}): Redemption => {
    const now = Date.now();
    return {
      id: '0xabc123def456',
      chainId: 'BaseSepolia',
      event: {
        redeemerOutputScript: '0x76a914abcdef1234567890abcdef1234567890abcdef1234567890',
        amount: ethers.BigNumber.from('1000000'),
        l2TransactionHash: '0xabc123def456',
      } as RedemptionRequestedEventData,
      serializedVaaBytes: new Uint8Array([1, 2, 3, 4, 5]),
      vaaStatus: RedemptionStatus.VAA_FETCHED,
      l1SubmissionTxHash: null,
      status: RedemptionStatus.VAA_FETCHED,
      error: null,
      dates: {
        createdAt: now,
        vaaFetchedAt: now,
        l1SubmittedAt: null,
        completedAt: null,
        lastActivityAt: now,
      },
      logs: [],
      retryCount: 0,
      ...overrides,
    };
  };

  beforeAll(async () => {
    mockChainConfig = {
      chainName: 'BaseSepolia',
      chainType: CHAIN_TYPE.EVM,
      network: NETWORK.TESTNET,
      privateKey: '0x1234567890123456789012345678901234567890123456789012345678901234',
      l1Confirmations: 6,
      l1Rpc: 'http://l1-rpc.test',
      l2Rpc: 'http://l2-rpc.test',
      l2WsRpc: 'ws://l2-ws.test',
      l1BitcoinDepositorAddress: '0x1234567890123456789012345678901234567890',
      l1BitcoinDepositorStartBlock: 1000,
      l2BitcoinDepositorAddress: '0x2234567890123456789012345678901234567890',
      l2BitcoinDepositorStartBlock: 2000,
      l2BitcoinRedeemerAddress: '0x5234567890123456789012345678901234567890',
      l2BitcoinRedeemerStartBlock: 3000,
      l2WormholeGatewayAddress: '0x3234567890123456789012345678901234567890',
      l2WormholeChainId: 30,
      vaultAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      useEndpoint: false,
      enableL2Redemption: true,
    } as EvmChainConfig;

    service = await L2RedemptionService.create(mockChainConfig);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedemptionStoreGetByStatus.mockResolvedValue([]);
    mockRedemptionStoreUpdate.mockResolvedValue(undefined);
  });

  describe('processVaaFetchedRedemptions', () => {
    describe('Success path', () => {
      it('should complete redemption when handler returns success (status = COMPLETED, txHash set)', async () => {
        // Arrange
        const mockRedemption = createMockRedemption();
        const successResult: L1RelayResult = {
          success: true,
          txHash: '0xsuccesstxhash123456789',
          isRetryable: false,
        };

        mockRedemptionStoreGetByStatus.mockResolvedValue([mockRedemption]);
        mockRelayRedemptionToL1.mockResolvedValue(successResult);

        // Act
        await service.processVaaFetchedRedemptions();

        // Assert
        expect(mockRedemptionStoreUpdate).toHaveBeenCalledTimes(1);
        const updatedRedemption = mockRedemptionStoreUpdate.mock.calls[0][0] as Redemption;

        expect(updatedRedemption.status).toBe(RedemptionStatus.COMPLETED);
        expect(updatedRedemption.l1SubmissionTxHash).toBe('0xsuccesstxhash123456789');
        expect(updatedRedemption.dates.completedAt).not.toBeNull();
        expect(updatedRedemption.error).toBeNull();
      });
    });

    describe('Retryable error path', () => {
      it('should keep VAA_FETCHED status when handler returns retryable error', async () => {
        // Arrange
        const mockRedemption = createMockRedemption({ retryCount: 0 });
        const retryableResult: L1RelayResult = {
          success: false,
          error: 'pending redemption detected',
          isRetryable: true,
        };

        mockRedemptionStoreGetByStatus.mockResolvedValue([mockRedemption]);
        mockRelayRedemptionToL1.mockResolvedValue(retryableResult);

        // Act
        await service.processVaaFetchedRedemptions();

        // Assert
        expect(mockRedemptionStoreUpdate).toHaveBeenCalledTimes(1);
        const updatedRedemption = mockRedemptionStoreUpdate.mock.calls[0][0] as Redemption;

        // Status should remain VAA_FETCHED for retry on next cycle
        expect(updatedRedemption.status).toBe(RedemptionStatus.VAA_FETCHED);
      });

      it('should increment retryCount when handler returns retryable error', async () => {
        // Arrange - Test starting from 0
        const mockRedemption = createMockRedemption({ retryCount: 0 });
        const retryableResult: L1RelayResult = {
          success: false,
          error: 'pending redemption collision',
          isRetryable: true,
        };

        mockRedemptionStoreGetByStatus.mockResolvedValue([mockRedemption]);
        mockRelayRedemptionToL1.mockResolvedValue(retryableResult);

        // Act
        await service.processVaaFetchedRedemptions();

        // Assert
        expect(mockRedemptionStoreUpdate).toHaveBeenCalledTimes(1);
        const updatedRedemption = mockRedemptionStoreUpdate.mock.calls[0][0] as Redemption;

        expect(updatedRedemption.retryCount).toBe(1);
      });

      it('should increment retryCount from existing value when handler returns retryable error', async () => {
        // Arrange - Test starting from 4 (should become 5)
        const mockRedemption = createMockRedemption({ retryCount: 4 });
        const retryableResult: L1RelayResult = {
          success: false,
          error: 'pending redemption collision',
          isRetryable: true,
        };

        mockRedemptionStoreGetByStatus.mockResolvedValue([mockRedemption]);
        mockRelayRedemptionToL1.mockResolvedValue(retryableResult);

        // Act
        await service.processVaaFetchedRedemptions();

        // Assert
        expect(mockRedemptionStoreUpdate).toHaveBeenCalledTimes(1);
        const updatedRedemption = mockRedemptionStoreUpdate.mock.calls[0][0] as Redemption;

        expect(updatedRedemption.retryCount).toBe(5);
      });

      it('should preserve error message from handler when retryable error occurs', async () => {
        // Arrange
        const mockRedemption = createMockRedemption({ retryCount: 0 });
        const errorMessage = 'pending redemption detected - collision with existing request';
        const retryableResult: L1RelayResult = {
          success: false,
          error: errorMessage,
          isRetryable: true,
        };

        mockRedemptionStoreGetByStatus.mockResolvedValue([mockRedemption]);
        mockRelayRedemptionToL1.mockResolvedValue(retryableResult);

        // Act
        await service.processVaaFetchedRedemptions();

        // Assert
        expect(mockRedemptionStoreUpdate).toHaveBeenCalledTimes(1);
        const updatedRedemption = mockRedemptionStoreUpdate.mock.calls[0][0] as Redemption;

        expect(updatedRedemption.error).toContain('pending redemption detected');
      });
    });

    describe('Max retry enforcement', () => {
      it('should transition to FAILED status when retryCount reaches 10 (max retries exceeded)', async () => {
        // Arrange - retryCount is 9, after increment it will be 10 and should fail
        const mockRedemption = createMockRedemption({ retryCount: 9 });
        const retryableResult: L1RelayResult = {
          success: false,
          error: 'pending redemption collision',
          isRetryable: true,
        };

        mockRedemptionStoreGetByStatus.mockResolvedValue([mockRedemption]);
        mockRelayRedemptionToL1.mockResolvedValue(retryableResult);

        // Act
        await service.processVaaFetchedRedemptions();

        // Assert
        expect(mockRedemptionStoreUpdate).toHaveBeenCalledTimes(1);
        const updatedRedemption = mockRedemptionStoreUpdate.mock.calls[0][0] as Redemption;

        // When retryCount reaches 10, status should become FAILED
        expect(updatedRedemption.retryCount).toBe(10);
        expect(updatedRedemption.status).toBe(RedemptionStatus.FAILED);
        expect(updatedRedemption.error).toContain('Max retries');
      });

      it('should keep VAA_FETCHED when retryCount is below max (retryCount = 8, becomes 9)', async () => {
        // Arrange - retryCount is 8, after increment it will be 9 (still below max 10)
        const mockRedemption = createMockRedemption({ retryCount: 8 });
        const retryableResult: L1RelayResult = {
          success: false,
          error: 'pending redemption collision',
          isRetryable: true,
        };

        mockRedemptionStoreGetByStatus.mockResolvedValue([mockRedemption]);
        mockRelayRedemptionToL1.mockResolvedValue(retryableResult);

        // Act
        await service.processVaaFetchedRedemptions();

        // Assert
        expect(mockRedemptionStoreUpdate).toHaveBeenCalledTimes(1);
        const updatedRedemption = mockRedemptionStoreUpdate.mock.calls[0][0] as Redemption;

        expect(updatedRedemption.retryCount).toBe(9);
        // At 9 retries, it should still be VAA_FETCHED, not FAILED
        expect(updatedRedemption.status).toBe(RedemptionStatus.VAA_FETCHED);
      });
    });

    describe('Permanent error path', () => {
      it('should transition to FAILED status immediately when error is not retryable', async () => {
        // Arrange
        const mockRedemption = createMockRedemption({ retryCount: 0 });
        const permanentError: L1RelayResult = {
          success: false,
          error: 'VAA was already executed',
          isRetryable: false,
        };

        mockRedemptionStoreGetByStatus.mockResolvedValue([mockRedemption]);
        mockRelayRedemptionToL1.mockResolvedValue(permanentError);

        // Act
        await service.processVaaFetchedRedemptions();

        // Assert
        expect(mockRedemptionStoreUpdate).toHaveBeenCalledTimes(1);
        const updatedRedemption = mockRedemptionStoreUpdate.mock.calls[0][0] as Redemption;

        // Permanent error should immediately fail, without incrementing retryCount
        expect(updatedRedemption.status).toBe(RedemptionStatus.FAILED);
        expect(updatedRedemption.retryCount).toBe(0); // Should not increment on permanent failure
        expect(updatedRedemption.error).toContain('VAA was already executed');
      });
    });

    describe('redeemerOutputScript handling', () => {
      it('should pass redeemerOutputScript from event to handler as 5th parameter', async () => {
        // Arrange
        const redeemerOutputScript = '0x76a914abcdef1234567890abcdef1234567890abcdef1234567890';
        const mockRedemption = createMockRedemption({
          event: {
            redeemerOutputScript,
            amount: ethers.BigNumber.from('1000000'),
            l2TransactionHash: '0xabc123def456',
          },
        });
        const successResult: L1RelayResult = {
          success: true,
          txHash: '0xsuccesstxhash',
          isRetryable: false,
        };

        mockRedemptionStoreGetByStatus.mockResolvedValue([mockRedemption]);
        mockRelayRedemptionToL1.mockResolvedValue(successResult);

        // Act
        await service.processVaaFetchedRedemptions();

        // Assert
        expect(mockRelayRedemptionToL1).toHaveBeenCalledTimes(1);
        const callArgs = mockRelayRedemptionToL1.mock.calls[0];

        // Verify the 5th argument is the redeemerOutputScript
        expect(callArgs[4]).toBe(redeemerOutputScript);
      });
    });
  });
});
