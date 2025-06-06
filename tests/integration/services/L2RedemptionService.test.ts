// tests/integration/services/L2RedemptionService.test.ts - Integration tests for L2RedemptionService
//
// This suite tests the L2RedemptionService's lifecycle, event processing, and batch/phase logic with mocked dependencies.
// It covers creation, event handling, store interactions, and error handling.

import * as AllEthers from 'ethers';
import { L2RedemptionService } from '../../../services/L2RedemptionService.js';
import { WormholeVaaService } from '../../../services/WormholeVaaService.js';
import { RedemptionStore } from '../../../utils/RedemptionStore.js';
import { RedemptionStatus } from '../../../types/Redemption.type.js';
import {
  createMockChainConfig,
  createMockRedemptionEvent,
  createMockRedemption,
  createMockVaaResponse,
  createMockEthersEvent,
} from '../../mocks/L2RedemptionServiceTestData.js';

// Mock all external dependencies
jest.mock('../../../services/WormholeVaaService.js');
// Corrected and enhanced mock for L1RedemptionHandlerRegistry
jest.mock('../../../handlers/L1RedemptionHandlerRegistry.ts', () => ({
  l1RedemptionHandlerRegistry: {
    get: jest.fn(),
    list: jest.fn(() => []), // Add mocks for other methods if they exist and might be called
    clear: jest.fn(),
  },
}));
jest.mock('../../../utils/RedemptionStore.js');
jest.mock('ethers');

// Create properly typed mocks
const MockedWormholeVaaService = jest.mocked(WormholeVaaService);
const MockedRedemptionStore = jest.mocked(RedemptionStore);
const MockedEthers = jest.mocked(AllEthers, { shallow: false });

// Import the mocked version of the registry for use in beforeEach
// This import MUST come AFTER jest.mock
import { l1RedemptionHandlerRegistry } from '../../../handlers/L1RedemptionHandlerRegistry.js';

describe('L2RedemptionService Integration Tests - Optimized', () => {
  let service: L2RedemptionService;
  let mockChainConfig: any;
  let mockProvider: jest.Mocked<AllEthers.providers.JsonRpcProvider>;
  let mockContract: jest.Mocked<AllEthers.Contract>;
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

    // Mock L1RedemptionHandler (this is the object our mocked registry.get will return)
    mockL1RedemptionHandler = {
      submitRedemptionDataToL1: jest.fn(),
      // Ensure all methods that L2RedemptionService might call on L1Handler instances are mocked here
      // For example, if it also called l1Handler.someOtherMethod(), it should be:
      // someOtherMethod: jest.fn(),
    };
    // Configure the mocked registry's get method
    // l1RedemptionHandlerRegistry is now the mocked object from the factory
    (l1RedemptionHandlerRegistry.get as jest.Mock).mockReturnValue(mockL1RedemptionHandler);

    // Mock RedemptionStore methods
    MockedRedemptionStore.getById = jest.fn().mockResolvedValue(null);
    MockedRedemptionStore.create = jest.fn().mockResolvedValue(undefined);
    MockedRedemptionStore.update = jest.fn().mockResolvedValue(undefined);
    MockedRedemptionStore.getByStatus = jest.fn().mockResolvedValue([]);

    service = await L2RedemptionService.create(mockChainConfig);
  });

  describe('✅ Service Lifecycle Management', () => {
    it('should handle valid config → successful creation & listening setup', async () => {
      // Service should be created successfully
      expect(service).toBeDefined();
      expect(MockedWormholeVaaService.create).toHaveBeenCalledWith(mockChainConfig.l2Rpc);
    });

    it('should handle missing L2 contract → graceful degradation', async () => {
      const configWithoutContract = createMockChainConfig({
        l2BitcoinRedeemerAddress: undefined,
      });

      // Should still create service but with degraded functionality
      const degradedService = await L2RedemptionService.create(configWithoutContract);
      expect(degradedService).toBeDefined();
    });

    it('should handle invalid config → proper error handling', async () => {
      MockedWormholeVaaService.create.mockRejectedValueOnce(
        new Error('Invalid L2 RPC configuration'),
      );

      // Should reject with proper error message
      await expect(L2RedemptionService.create(mockChainConfig)).rejects.toThrow(
        'Invalid L2 RPC configuration',
      );
    });

    it('should handle start/stop listening lifecycle', () => {
      MockedWormholeVaaService.create.mockResolvedValue(mockWormholeVaaService);

      service.startListening();
      expect(mockContract.on).toHaveBeenCalledWith('RedemptionRequested', expect.any(Function));

      service.stopListening();
      expect(mockContract.removeAllListeners).toHaveBeenCalledWith('RedemptionRequested');
    });
  });

  describe('✅ Event Processing & Store Interactions', () => {
    it('should handle new redemption creation with proper data mapping', async () => {
      const mockEvent = createMockRedemptionEvent();
      const mockEthersEvent = createMockEthersEvent();

      const createSpy = jest.fn();
      MockedRedemptionStore.create.mockImplementation(async (redemption: any) => {
        createSpy(redemption);
      });

      service.startListening();
      const eventHandler = mockContract.on.mock.calls[0][1];

      await eventHandler(
        mockEvent.walletPubKeyHash,
        mockEvent.mainUtxo,
        mockEvent.redeemerOutputScript,
        mockEvent.amount,
        mockEthersEvent,
      );

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          chainId: mockChainConfig.chainName,
          status: RedemptionStatus.PENDING,
          event: expect.objectContaining({
            walletPubKeyHash: mockEvent.walletPubKeyHash,
            l2TransactionHash: mockEthersEvent.transactionHash,
          }),
        }),
      );
    });

    it('should handle duplicate event detection and skipping', async () => {
      const existingRedemption = createMockRedemption();
      MockedRedemptionStore.getById.mockResolvedValue(existingRedemption);

      const mockEvent = createMockRedemptionEvent();
      const mockEthersEvent = createMockEthersEvent();

      service.startListening();
      const eventHandler = mockContract.on.mock.calls[0][1];

      await eventHandler(
        mockEvent.walletPubKeyHash,
        mockEvent.mainUtxo,
        mockEvent.redeemerOutputScript,
        mockEvent.amount,
        mockEthersEvent,
      );

      // Should not create duplicate redemption
      expect(MockedRedemptionStore.create).not.toHaveBeenCalled();
    });

    it('should handle store operation failures (create/update errors)', async () => {
      MockedRedemptionStore.create.mockRejectedValueOnce(new Error('Database write failed'));

      const mockEvent = createMockRedemptionEvent();
      const mockEthersEvent = createMockEthersEvent();

      service.startListening();
      const eventHandler = mockContract.on.mock.calls[0][1];

      // Should not throw, but log error internally
      await expect(
        eventHandler(
          mockEvent.walletPubKeyHash,
          mockEvent.mainUtxo,
          mockEvent.redeemerOutputScript,
          mockEvent.amount,
          mockEthersEvent,
        ),
      ).resolves.not.toThrow();
    });
  });

  describe('✅ Phase Processing with Dependency Failures', () => {
    it('should handle batch processing behavior (multiple redemptions)', async () => {
      const pendingRedemptions = [
        createMockRedemption(RedemptionStatus.PENDING, { id: 'redemption-1' }),
        createMockRedemption(RedemptionStatus.PENDING, { id: 'redemption-2' }),
      ];
      const vaaFailedRedemptions = [
        createMockRedemption(RedemptionStatus.VAA_FAILED, { id: 'redemption-3' }),
      ];

      const redemptionUpdates: any[] = [];
      MockedRedemptionStore.update.mockImplementation(async (redemption: any) => {
        redemptionUpdates.push(redemption);
      });

      mockWormholeVaaService.fetchAndVerifyVaaForL2Event
        .mockResolvedValueOnce(createMockVaaResponse(true)) // Success for first PENDING
        .mockResolvedValueOnce(null) // Failure for second PENDING
        .mockResolvedValueOnce(createMockVaaResponse(true)) // Success for first VAA_FAILED
        .mockResolvedValueOnce(null); // Failure for second VAA_FAILED (if any)

      MockedRedemptionStore.getByStatus
        .mockResolvedValueOnce(pendingRedemptions) // PENDING redemptions
        .mockResolvedValueOnce(vaaFailedRedemptions); // VAA_FAILED redemptions

      await service.processPendingRedemptions();

      // Should have processed all redemptions
      expect(redemptionUpdates).toHaveLength(3); // 2 PENDING + 1 VAA_FAILED
      expect(redemptionUpdates[0].status).toBe(RedemptionStatus.VAA_FETCHED); // Success
      expect(redemptionUpdates[1].status).toBe(RedemptionStatus.VAA_FAILED); // Failure
      expect(redemptionUpdates[2].status).toBe(RedemptionStatus.VAA_FETCHED); // Retry success
    });

    it('should handle dependency failures (WormholeVaaService, L1RedemptionHandler)', async () => {
      // Reset store update mock to default for this test, isolating from batch test
      MockedRedemptionStore.update = jest.fn().mockResolvedValue(undefined);

      // Part 1: WormholeVaaService failure (Logic for this part seems to be removed or commented out)
      // const redemption1 = createMockRedemption(RedemptionStatus.PENDING); // This was unused
      const vaaFetchedRedemptions = [createMockRedemption(RedemptionStatus.VAA_FETCHED)];

      const redemptionUpdates: any[] = [];
      MockedRedemptionStore.update.mockImplementation(async (redemption: any) => {
        redemptionUpdates.push(redemption);
      });

      MockedRedemptionStore.getByStatus.mockResolvedValueOnce(vaaFetchedRedemptions);

      // L1 handler failure
      mockL1RedemptionHandler.submitRedemptionDataToL1.mockRejectedValueOnce(
        new Error('L1 network timeout'),
      );

      await service.processVaaFetchedRedemptions();

      expect(redemptionUpdates).toHaveLength(1);
      expect(redemptionUpdates[0].status).toBe(RedemptionStatus.FAILED);
      expect(redemptionUpdates[0].error).toContain('L1 network timeout');
    });

    it('should handle partial failure handling (some succeed, some fail)', async () => {
      const redemptions = [
        createMockRedemption(RedemptionStatus.PENDING, { id: 'success-redemption' }),
        createMockRedemption(RedemptionStatus.PENDING, { id: 'fail-redemption' }),
      ];

      const redemptionUpdates: any[] = [];
      MockedRedemptionStore.update.mockImplementation(async (redemption: any) => {
        redemptionUpdates.push(redemption);
      });

      MockedRedemptionStore.getByStatus
        .mockResolvedValueOnce(redemptions)
        .mockResolvedValueOnce([]); // No VAA_FAILED

      mockWormholeVaaService.fetchAndVerifyVaaForL2Event
        .mockResolvedValueOnce(createMockVaaResponse(true)) // Success
        .mockResolvedValueOnce(null); // Failure

      await service.processPendingRedemptions();

      expect(redemptionUpdates).toHaveLength(2);
      expect(redemptionUpdates[0].status).toBe(RedemptionStatus.VAA_FETCHED);
      expect(redemptionUpdates[1].status).toBe(RedemptionStatus.VAA_FAILED);
    });

    it('should handle store update failures during processing', async () => {
      const redemptions = [createMockRedemption(RedemptionStatus.PENDING)];

      MockedRedemptionStore.getByStatus
        .mockResolvedValueOnce(redemptions)
        .mockResolvedValueOnce([]);

      MockedRedemptionStore.update
        .mockRejectedValueOnce(new Error('Database locked')) // First update fails
        .mockResolvedValueOnce(undefined); // Second update succeeds

      mockWormholeVaaService.fetchAndVerifyVaaForL2Event
        .mockResolvedValueOnce(createMockVaaResponse(true))
        .mockResolvedValueOnce(createMockVaaResponse(true));

      MockedRedemptionStore.getByStatus
        .mockResolvedValueOnce(redemptions)
        .mockResolvedValueOnce([]);

      // Should not throw even with store failures
      await expect(service.processPendingRedemptions()).resolves.not.toThrow();

      // VAA service should still be called
      expect(mockWormholeVaaService.fetchAndVerifyVaaForL2Event).toHaveBeenCalled();
    });

    it('should handle no redemptions to process', async () => {
      MockedRedemptionStore.getByStatus.mockResolvedValueOnce([]); // No VAA_FETCHED

      // Should complete without errors
      await expect(service.processVaaFetchedRedemptions()).resolves.not.toThrow();

      // No L1 handler calls should be made
      expect(mockL1RedemptionHandler.submitRedemptionDataToL1).not.toHaveBeenCalled();
    });
  });
});
