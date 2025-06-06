// tests/e2e/L2RedemptionService.e2e.test.ts - E2E tests for L2RedemptionService
//
// This suite tests the full L2-to-L1 redemption pipeline for the tBTC cross-chain relayer.
// It covers event listening, VAA fetching, L1 submission, and error handling for redemptions.

import * as AllEthers from 'ethers';
import type { ChainId } from '@wormhole-foundation/sdk';
import { L2RedemptionService } from '../../services/L2RedemptionService.js';
import { WormholeVaaService } from '../../services/WormholeVaaService.js';
import { l1RedemptionHandlerRegistry } from '../../handlers/L1RedemptionHandlerRegistry.js';
import type { Redemption } from '../../types/Redemption.type.js';
import { RedemptionStatus } from '../../types/Redemption.type.js';
import type { EvmChainConfig } from '../../config/schemas/evm.chain.schema.js';
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
jest.mock('ethers', () => {
  const originalEthers = jest.requireActual('ethers') as typeof AllEthers;
  return {
    ...originalEthers,
    providers: {
      ...originalEthers.providers,
      // Mock the specific provider class used by the service
      JsonRpcProvider: jest.fn(),
    },
    Contract: jest.fn(), // Mock the Contract class
  };
});

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
const MockedEthers = AllEthers as jest.Mocked<typeof AllEthers> & {
  providers: {
    JsonRpcProvider: jest.MockedClass<typeof AllEthers.providers.JsonRpcProvider>;
  };
  Contract: jest.MockedClass<typeof AllEthers.Contract>;
};

describe('L2RedemptionService E2E Tests - Optimized', () => {
  let service: L2RedemptionService;
  let mockChainConfig: EvmChainConfig;
  let mockProvider: jest.Mocked<AllEthers.providers.JsonRpcProvider>;
  let mockContract: jest.Mocked<AllEthers.Contract>;
  let mockWormholeVaaService: jest.Mocked<WormholeVaaService>;
  let mockL1RedemptionHandler: { submitRedemptionDataToL1: jest.Mock };

  beforeEach(async () => {
    // Reset mocks before each test
    jest.clearAllMocks();

    mockChainConfig = createMockChainConfig();

    // Mock ethers provider
    mockProvider = {
      getTransactionReceipt: jest.fn(),
      on: jest.fn(),
      removeAllListeners: jest.fn(),
    } as unknown as jest.Mocked<AllEthers.providers.JsonRpcProvider>;

    // Mock ethers contract
    mockContract = {
      address: mockChainConfig.l2BitcoinRedeemerAddress,
      interface: {
        events: {
          RedemptionRequested: true,
        },
      } as unknown as AllEthers.utils.Interface,
      on: jest.fn(),
      removeAllListeners: jest.fn(),
    } as unknown as jest.Mocked<AllEthers.Contract>;

    // Setup mock for JsonRpcProvider constructor to return our mockProvider instance
    (MockedEthers.providers.JsonRpcProvider as unknown as jest.Mock).mockImplementation(
      () => mockProvider,
    );
    (MockedEthers.Contract as unknown as jest.Mock).mockImplementation(() => mockContract);

    // Mock WormholeVaaService
    mockWormholeVaaService = {
      fetchAndVerifyVaaForL2Event: jest.fn(),
    } as unknown as jest.Mocked<WormholeVaaService>;

    // Mock the static create method
    MockedWormholeVaaService.create = jest.fn().mockResolvedValue(mockWormholeVaaService);

    // Mock L1RedemptionHandler
    mockL1RedemptionHandler = {
      submitRedemptionDataToL1: jest.fn(),
    };
    (l1RedemptionHandlerRegistry.get as jest.Mock).mockReturnValue(mockL1RedemptionHandler);

    service = await L2RedemptionService.create(mockChainConfig);
  });

  // =====================
  // Complete L2-to-L1 Redemption Success Flow
  // =====================

  describe('Flow: Complete L2-to-L1 Redemption Success', () => {
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
      const redemptionUpdates: Array<{ action: string; redemption: Redemption }> = [];
      let createdRedemption: Redemption | null = null;
      let vaaFetchedRedemptionState: Redemption | null = null; // Variable to capture the state after VAA fetch

      // Setup mocked RedemptionStore methods
      mockRedemptionStore.getById.mockResolvedValue(null);
      mockRedemptionStore.create.mockImplementation(async (redemption: Redemption) => {
        createdRedemption = { ...redemption, logs: [...(redemption.logs || [])] }; // Ensure logs array is copied
        redemptionUpdates.push({ action: 'create', redemption: { ...createdRedemption } });
      });
      mockRedemptionStore.update.mockImplementation(async (redemption: Redemption) => {
        const updatedRedemption = { ...redemption, logs: [...(redemption.logs || [])] }; // Ensure logs array is copied
        redemptionUpdates.push({ action: 'update', redemption: updatedRedemption });
        if (updatedRedemption.status === RedemptionStatus.VAA_FETCHED) {
          // Capture the state of the redemption right after VAA processing saved it
          vaaFetchedRedemptionState = updatedRedemption;
        }
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
        .mockResolvedValueOnce([createdRedemption!]) // PENDING redemption for VAA processing
        .mockResolvedValueOnce([]) // No VAA_FAILED initially (for the first call to processPendingRedemptions)
        .mockImplementationOnce(async (status: RedemptionStatus) => {
          // This mock is for getting VAA_FETCHED items for L1 submission phase
          if (status === RedemptionStatus.VAA_FETCHED && vaaFetchedRedemptionState) {
            return [{ ...vaaFetchedRedemptionState }]; // Provide the state captured after VAA fetch & update
          }
          // This path should ideally not be hit if vaaFetchedRedemptionState is correctly populated
          // and the test calls getByStatus with VAA_FETCHED for this phase.
          // Throw an error to make test failure explicit if pre-conditions aren't met.
          throw new Error(
            `E2E Test Error: getByStatus mock for L1 phase called with status ${status} or vaaFetchedRedemptionState was null.`,
          );
        });

      // Process pending redemptions (VAA fetch phase)
      await service.processPendingRedemptions();

      // Crucial check: Ensure the VAA fetch phase actually updated and set our capture variable
      expect(vaaFetchedRedemptionState).toBeDefined();
      expect(vaaFetchedRedemptionState).not.toBeNull();
      expect(vaaFetchedRedemptionState!.status).toBe(RedemptionStatus.VAA_FETCHED);
      expect(
        vaaFetchedRedemptionState!.logs!.some((log: string) => /VAA fetched at/.test(log)),
      ).toBeTruthy();

      // Process VAA-fetched redemptions (L1 submission phase)
      await service.processVaaFetchedRedemptions();

      // Verify complete flow execution - should have create + 2 updates
      expect(redemptionUpdates).toHaveLength(3); // create + VAA update + completion update

      // Verify initial redemption creation
      const creation = redemptionUpdates.find((u) => u.action === 'create');
      const vaaFetchUpdate = redemptionUpdates.find(
        (u) => u.redemption.status === RedemptionStatus.VAA_FETCHED,
      );
      const completionUpdate = redemptionUpdates.find(
        (u) => u.redemption.status === RedemptionStatus.COMPLETED,
      );

      expect(creation).toBeDefined();
      expect(vaaFetchUpdate).toBeDefined();
      expect(completionUpdate).toBeDefined();

      // Verify logs if they exist on the objects
      expect(
        creation!.redemption.logs!.some((log: string) => /Redemption created at/.test(log)),
      ).toBeTruthy();
      expect(
        vaaFetchUpdate!.redemption.logs!.some((log: string) => /VAA fetched at/.test(log)),
      ).toBeTruthy();
      expect(
        completionUpdate!.redemption.logs!.some((log: string) =>
          /L1 submission succeeded at/.test(log),
        ),
      ).toBeTruthy();

      // Check dates
      expect(creation!.redemption.dates.createdAt).toBeDefined();
      expect(vaaFetchUpdate!.redemption.dates.vaaFetchedAt).toBeDefined();
      expect(completionUpdate!.redemption.dates.l1SubmittedAt).toBeDefined();
      expect(completionUpdate!.redemption.dates.completedAt).toBeDefined();

      const duration =
        completionUpdate!.redemption.dates.completedAt! - creation!.redemption.dates.createdAt;
      expect(duration).toBeGreaterThanOrEqual(0);

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
        completionUpdate!.redemption.logs!.some((log: string) => /Redemption created at/.test(log)),
      ).toBe(true);
      expect(
        completionUpdate!.redemption.logs!.some((log: string) => /VAA fetched at/.test(log)),
      ).toBe(true);
      expect(
        completionUpdate!.redemption.logs!.some((log: string) =>
          /L1 submission succeeded at/.test(log),
        ),
      ).toBe(true);

      // Performance check - should complete reasonably quickly
      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds for test
    }, 10000);
  });

  // =====================
  // Error Handling & Edge Case Tests
  // =====================

  describe('Flow: Critical Failure Points', () => {
    beforeEach(() => {
      // Reset all mocks before each test
      jest.clearAllMocks();
    });

    it('should handle VAA fetch failure AND L1 submission failure scenarios with proper error handling', async () => {
      // Test setup for multiple failure scenarios
      const mockPendingRedemption = createMockRedemption(RedemptionStatus.PENDING);
      const mockVaaFetchedRedemption = createMockRedemption(RedemptionStatus.VAA_FETCHED);

      const redemptionUpdates: Array<{ action: string; redemption: Redemption }> = [];
      mockRedemptionStore.update.mockImplementation(async (redemption: Redemption) => {
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
