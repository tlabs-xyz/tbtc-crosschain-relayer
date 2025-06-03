import { ethers } from 'ethers';
import type { ChainId } from '@wormhole-foundation/sdk';
import { L2RedemptionService } from '../../services/L2RedemptionService.js';
import { WormholeVaaService } from '../../services/WormholeVaaService.js';
import { l1RedemptionHandlerRegistry } from '../../handlers/L1RedemptionHandlerRegistry.js';
import { RedemptionStatus } from '../../types/Redemption.type.js';
import {
  createMockChainConfig,
  createMockRedemptionEvent,
  createMockRedemption,
  createMockVaaResponse,
  createMockEthersEvent,
} from '../mocks/L2RedemptionServiceTestData.js';

// Mock all external dependencies
jest.mock('../../services/WormholeVaaService.js');
jest.mock('../../handlers/L1RedemptionHandlerRegistry.js');
jest.mock('ethers');

// Mock RedemptionStore at module level for unit tests
jest.mock('../../utils/RedemptionStore.js', () => ({
  RedemptionStore: {
    getById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    getByStatus: jest.fn(),
    getAll: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
}));

// Import the mocked RedemptionStore to get a reference to the mock functions
import { RedemptionStore } from '../../utils/RedemptionStore.js';
const mockRedemptionStore = jest.mocked(RedemptionStore);

// Create properly typed mocks
const MockedWormholeVaaService = jest.mocked(WormholeVaaService);
const MockedEthers = jest.mocked(ethers);

describe('L2RedemptionService E2E Tests - Optimized', () => {
  let service: L2RedemptionService;
  let mockChainConfig: any;
  let mockProvider: jest.Mocked<ethers.providers.JsonRpcProvider>;
  let mockContract: jest.Mocked<ethers.Contract>;
  let mockWormholeVaaService: jest.Mocked<WormholeVaaService>;
  let mockL1RedemptionHandler: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockChainConfig = createMockChainConfig();

    // Mock ethers provider
    mockProvider = {
      getTransactionReceipt: jest.fn(),
      on: jest.fn(),
      removeAllListeners: jest.fn(),
    } as any;

    // Mock ethers contract
    mockContract = {
      address: mockChainConfig.l2BitcoinRedeemerAddress,
      interface: {
        events: {
          RedemptionRequested: true,
        },
      },
      on: jest.fn(),
      removeAllListeners: jest.fn(),
    } as any;

    // Mock ethers provider and contract constructors
    (MockedEthers.providers.JsonRpcProvider as any) = jest.fn(() => mockProvider);
    (MockedEthers.Contract as any) = jest.fn(() => mockContract);

    // Mock WormholeVaaService
    mockWormholeVaaService = {
      fetchAndVerifyVaaForL2Event: jest.fn(),
    } as any;

    // Mock the static create method
    MockedWormholeVaaService.create = jest.fn().mockResolvedValue(mockWormholeVaaService);

    // Mock L1RedemptionHandler
    mockL1RedemptionHandler = {
      submitRedemptionDataToL1: jest.fn(),
    };
    (l1RedemptionHandlerRegistry.get as jest.Mock).mockReturnValue(mockL1RedemptionHandler);

    service = await L2RedemptionService.create(mockChainConfig);
  });

  // Unit tests with mocked RedemptionStore
  describe('✅ Flow: Complete L2-to-L1 Redemption Success', () => {
    beforeEach(() => {
      // Reset all mocks before each test
      jest.clearAllMocks();
    });

    it('should complete the entire pipeline from L2 event → VAA fetch → L1 submission → COMPLETED', async () => {
      // Setup test data
      const mockEvent = createMockRedemptionEvent();
      const mockEthersEvent = createMockEthersEvent();
      const mockVaaResponse = createMockVaaResponse(true);
      const mockL1TxHash = '0x' + 'cd'.repeat(32);

      // Track redemption state changes
      const redemptionUpdates: any[] = [];
      let createdRedemption: any = null;

      // Setup mocked RedemptionStore methods
      mockRedemptionStore.getById.mockResolvedValue(null);
      mockRedemptionStore.create.mockImplementation(async (redemption: any) => {
        createdRedemption = { ...redemption };
        redemptionUpdates.push({ action: 'create', redemption: { ...redemption } });
      });
      mockRedemptionStore.update.mockImplementation(async (redemption: any) => {
        redemptionUpdates.push({ action: 'update', redemption: { ...redemption } });
      });

      // Setup mocks for successful flow
      mockWormholeVaaService.fetchAndVerifyVaaForL2Event.mockResolvedValue(mockVaaResponse);
      mockL1RedemptionHandler.submitRedemptionDataToL1.mockResolvedValue(mockL1TxHash);

      // Start event listening
      service.startListening();

      // Verify event listener setup
      expect(mockContract.on).toHaveBeenCalledWith('RedemptionRequested', expect.any(Function));

      // Simulate L2 event emission - this creates the redemption
      const eventHandler = mockContract.on.mock.calls[0][1];
      await eventHandler(
        mockEvent.walletPubKeyHash,
        mockEvent.mainUtxo,
        mockEvent.redeemerOutputScript,
        mockEvent.amount,
        mockEthersEvent,
      );

      // Ensure redemption was created
      expect(createdRedemption).toBeTruthy();
      expect(mockRedemptionStore.create).toHaveBeenCalledTimes(1);

      // Setup store queries to return the created redemption for processing phases
      mockRedemptionStore.getByStatus
        .mockResolvedValueOnce([createdRedemption]) // PENDING redemption for VAA processing
        .mockResolvedValueOnce([]) // No VAA_FAILED initially
        .mockResolvedValueOnce([
          { ...createdRedemption, status: RedemptionStatus.VAA_FETCHED, vaaBytes: '0x123' },
        ]); // VAA_FETCHED for L1 submission

      // Process pending redemptions (VAA fetch phase)
      await service.processPendingRedemptions();

      // Process VAA-fetched redemptions (L1 submission phase)
      await service.processVaaFetchedRedemptions();

      // Verify complete flow execution - should have create + 2 updates
      expect(redemptionUpdates).toHaveLength(3); // create + VAA update + completion update

      // Verify initial redemption creation
      const creation = redemptionUpdates[0];
      expect(creation.action).toBe('create');
      expect(creation.redemption.status).toBe(RedemptionStatus.PENDING);
      expect(creation.redemption.event).toEqual(
        expect.objectContaining({
          walletPubKeyHash: mockEvent.walletPubKeyHash,
          l2TransactionHash: mockEthersEvent.transactionHash,
        }),
      );

      // Verify VAA fetch phase
      const vaaUpdate = redemptionUpdates[1];
      expect(vaaUpdate.action).toBe('update');
      expect(vaaUpdate.redemption.status).toBe(RedemptionStatus.VAA_FETCHED);
      expect(vaaUpdate.redemption.vaaStatus).toBe(RedemptionStatus.VAA_FETCHED);
      expect(vaaUpdate.redemption.vaaBytes).toBeTruthy();
      expect(vaaUpdate.redemption.dates.vaaFetchedAt).toBeTruthy();
      expect(vaaUpdate.redemption.error).toBeNull();

      // Verify L1 submission phase
      const completionUpdate = redemptionUpdates[2];
      expect(completionUpdate.action).toBe('update');
      expect(completionUpdate.redemption.status).toBe(RedemptionStatus.COMPLETED);
      expect(completionUpdate.redemption.l1SubmissionTxHash).toBe(mockL1TxHash);
      expect(completionUpdate.redemption.dates.completedAt).toBeTruthy();
      expect(completionUpdate.redemption.dates.l1SubmittedAt).toBeTruthy();

      // Verify external service calls
      expect(mockWormholeVaaService.fetchAndVerifyVaaForL2Event).toHaveBeenCalledWith(
        expect.any(String),
        mockChainConfig.l2WormholeChainId as ChainId,
        mockChainConfig.l2WormholeGatewayAddress,
        2, // DEFAULT_TARGET_L1_CHAIN_ID
      );

      expect(mockL1RedemptionHandler.submitRedemptionDataToL1).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Buffer),
      );

      // Verify timing and logging
      expect(
        completionUpdate.redemption.logs.some((log: string) => /Redemption created at/.test(log)),
      ).toBe(true);
      expect(
        completionUpdate.redemption.logs.some((log: string) => /VAA fetched at/.test(log)),
      ).toBe(true);
      expect(
        completionUpdate.redemption.logs.some((log: string) =>
          /L1 submission succeeded at/.test(log),
        ),
      ).toBe(true);

      // Performance check - should complete reasonably quickly
      const totalTime =
        completionUpdate.redemption.dates.completedAt - creation.redemption.dates.createdAt;
      expect(totalTime).toBeLessThan(10000); // Should complete within 10 seconds for test
    }, 10000);
  });

  describe('✅ Flow: Critical Failure Points', () => {
    beforeEach(() => {
      // Reset all mocks before each test
      jest.clearAllMocks();
    });

    it('should handle VAA fetch failure AND L1 submission failure scenarios with proper error handling', async () => {
      // Test setup for multiple failure scenarios
      const mockPendingRedemption = createMockRedemption(RedemptionStatus.PENDING);
      const mockVaaFetchedRedemption = createMockRedemption(RedemptionStatus.VAA_FETCHED);

      const redemptionUpdates: any[] = [];
      mockRedemptionStore.update.mockImplementation(async (redemption: any) => {
        redemptionUpdates.push({ action: 'update', redemption: { ...redemption } });
      });

      // === SCENARIO 1: VAA fetch failure ===
      mockWormholeVaaService.fetchAndVerifyVaaForL2Event.mockResolvedValueOnce(null); // VAA fetch fails

      // Setup store to return pending redemption for VAA processing
      mockRedemptionStore.getByStatus
        .mockResolvedValueOnce([mockPendingRedemption]) // PENDING redemptions
        .mockResolvedValueOnce([]); // No VAA_FAILED initially

      // Process pending redemptions - should result in VAA_FAILED status
      await service.processPendingRedemptions();

      // Verify VAA fetch failure handling
      expect(redemptionUpdates).toHaveLength(1);
      const vaaFailureUpdate = redemptionUpdates[0];
      expect(vaaFailureUpdate.redemption.status).toBe(RedemptionStatus.VAA_FAILED);
      expect(vaaFailureUpdate.redemption.vaaStatus).toBe(RedemptionStatus.VAA_FAILED);
      expect(vaaFailureUpdate.redemption.error).toBe('VAA fetch/verify failed');
      expect(vaaFailureUpdate.redemption.vaaBytes).toBeNull();

      // Clear updates for next scenario
      redemptionUpdates.length = 0;

      // === SCENARIO 2: L1 submission failure ===
      mockL1RedemptionHandler.submitRedemptionDataToL1.mockResolvedValueOnce(null); // L1 submission fails

      // Setup store to return VAA-fetched redemption for L1 processing
      mockRedemptionStore.getByStatus.mockResolvedValueOnce([mockVaaFetchedRedemption]);

      // Process VAA-fetched redemptions - should result in FAILED status
      await service.processVaaFetchedRedemptions();

      // Verify L1 submission failure handling
      expect(redemptionUpdates).toHaveLength(1);
      const l1FailureUpdate = redemptionUpdates[0];
      expect(l1FailureUpdate.redemption.status).toBe(RedemptionStatus.FAILED);
      expect(l1FailureUpdate.redemption.error).toBe('L1 submission failed (see logs for details)');
      expect(l1FailureUpdate.redemption.l1SubmissionTxHash).toBeNull();

      // Verify service interactions
      expect(mockWormholeVaaService.fetchAndVerifyVaaForL2Event).toHaveBeenCalledTimes(1);
      expect(mockL1RedemptionHandler.submitRedemptionDataToL1).toHaveBeenCalledTimes(1);

      // Verify all updates were through RedemptionStore.update
      expect(mockRedemptionStore.update).toHaveBeenCalledTimes(2);

      // Only this scenario after clearing
      expect(mockL1RedemptionHandler.submitRedemptionDataToL1).toHaveBeenCalledTimes(1); // Only one L1 call after clearing

      // Performance check - failure handling should be fast
      const lastUpdate = redemptionUpdates[redemptionUpdates.length - 1];
      expect(lastUpdate.redemption.dates.lastActivityAt).toBeTruthy();
    }, 10000);
  });
});
