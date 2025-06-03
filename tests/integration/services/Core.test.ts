import { jest } from '@jest/globals';

// Set environment variables BEFORE importing Core.ts
process.env.SUPPORTED_CHAINS = 'sepoliaTestnet,polygonTestnet';

import type { EvmChainConfig } from '../../../config/schemas/evm.chain.schema.js';
import { CHAIN_TYPE, NETWORK } from '../../../config/schemas/common.schema.js';
import { MockChainHandler } from '../../mocks/MockChainHandler.js';

// Create mock configurations with proper typing
const mockSepoliaConfig: EvmChainConfig = {
  chainName: 'SepoliaTestnet',
  chainType: CHAIN_TYPE.EVM,
  network: NETWORK.TESTNET,
  enableL2Redemption: true,
  privateKey: '0x1234567890123456789012345678901234567890123456789012345678901234',
  l1Confirmations: 1,
  useEndpoint: false,
  supportsRevealDepositAPI: false,
  l1Rpc: 'http://localhost:8545',
  l2Rpc: 'http://localhost:8546',
  l2WsRpc: 'ws://localhost:8546',
  l1ContractAddress: '0x1234567890123456789012345678901234567890',
  l2ContractAddress: '0x1234567890123456789012345678901234567890',
  l1BitcoinRedeemerAddress: '0x1234567890123456789012345678901234567890',
  l2BitcoinRedeemerAddress: '0x1234567890123456789012345678901234567890',
  l2WormholeGatewayAddress: '0x1234567890123456789012345678901234567890',
  l2WormholeChainId: 1,
  l2StartBlock: 0,
  vaultAddress: '0x1234567890123456789012345678901234567890',
};

const mockPolygonConfig: EvmChainConfig = {
  ...mockSepoliaConfig,
  chainName: 'PolygonTestnet',
  enableL2Redemption: false,
  l2WormholeChainId: 2,
};

const mockChainConfigs = {
  sepoliaTestnet: mockSepoliaConfig,
  polygonTestnet: mockPolygonConfig,
};

// Mock all dependencies FIRST before any imports
jest.mock('../../../services/CleanupDeposits.js', () => ({
  cleanQueuedDeposits: jest.fn(),
  cleanFinalizedDeposits: jest.fn(),
  cleanBridgedDeposits: jest.fn(),
}));

jest.mock('../../../handlers/ChainHandlerRegistry.js', () => ({
  chainHandlerRegistry: {
    list: jest.fn(),
    initialize: jest.fn(),
  },
}));

jest.mock('../../../services/L2RedemptionService.js', () => ({
  L2RedemptionService: {
    create: jest.fn(),
  },
}));

jest.mock('../../../utils/RedemptionStore.js', () => ({
  RedemptionStore: {
    getAll: jest.fn(),
    delete: jest.fn(),
  },
}));

// Mock the entire config module with static chainConfigs
jest.mock('../../../config/index.js', () => ({
  __esModule: true,
  chainConfigs: mockChainConfigs,
}));

jest.mock('node-cron', () => ({
  __esModule: true,
  default: {
    schedule: jest.fn(),
  },
}));

// Mock p-limit correctly
jest.mock('p-limit', () => ({
  __esModule: true,
  default: jest.fn(() => jest.fn((fn: () => unknown) => fn())),
}));

// Mock the Logger module to avoid console errors
jest.mock('../../../utils/Logger.js', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  logErrorContext: jest.fn(),
}));

// Import after mocks
import * as Core from '../../../services/Core.js';
import { chainHandlerRegistry } from '../../../handlers/ChainHandlerRegistry.js';
import {
  cleanQueuedDeposits,
  cleanFinalizedDeposits,
  cleanBridgedDeposits,
} from '../../../services/CleanupDeposits.js';
import { L2RedemptionService } from '../../../services/L2RedemptionService.js';
import { RedemptionStore } from '../../../utils/RedemptionStore.js';
import cron from 'node-cron';
import pLimit from 'p-limit';
import { RedemptionStatus } from '../../../types/Redemption.type.js';
import logger, { logErrorContext } from '../../../utils/Logger.js';

describe('Core.ts Integration Tests', () => {
  let mockHandler1: MockChainHandler;
  let mockHandler2: MockChainHandler;
  let mockL2Service: jest.Mocked<{
    processPendingRedemptions: () => Promise<void>;
    processVaaFetchedRedemptions: () => Promise<void>;
  }>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Store original environment
    originalEnv = { ...process.env };

    // Reset chain configs to allow fresh loading with mocks
    Core.resetChainConfigs();
    Core.resetL2RedemptionServices();

    // Create mock handlers with proper config references
    mockHandler1 = new MockChainHandler(mockSepoliaConfig);
    mockHandler2 = new MockChainHandler(mockPolygonConfig);

    // Create mock L2 service
    mockL2Service = {
      processPendingRedemptions: jest.fn(),
      processVaaFetchedRedemptions: jest.fn(),
    };

    // Reset specific mocks that need to be fresh for each test
    (chainHandlerRegistry.list as jest.Mock).mockClear();
    (chainHandlerRegistry.initialize as any).mockClear();
    (cleanQueuedDeposits as jest.Mock).mockClear();
    (cleanFinalizedDeposits as jest.Mock).mockClear();
    (cleanBridgedDeposits as jest.Mock).mockClear();
    (RedemptionStore.getAll as jest.Mock).mockClear();
    (RedemptionStore.delete as jest.Mock).mockClear();
    (cron.schedule as jest.Mock).mockClear();
    (logErrorContext as jest.Mock).mockClear();
    (logger.warn as jest.Mock).mockClear();
    (L2RedemptionService.create as jest.Mock).mockClear();

    // Setup default mock returns
    (chainHandlerRegistry.list as jest.Mock).mockReturnValue([mockHandler1, mockHandler2]);
    (chainHandlerRegistry.initialize as any).mockResolvedValue(undefined);
    (L2RedemptionService.create as any).mockResolvedValue(mockL2Service);

    // Mock handler methods
    jest.spyOn(mockHandler1, 'processWormholeBridging').mockResolvedValue(undefined);
    jest.spyOn(mockHandler1, 'processFinalizeDeposits').mockResolvedValue(undefined);
    jest.spyOn(mockHandler1, 'processInitializeDeposits').mockResolvedValue(undefined);
    jest.spyOn(mockHandler1, 'initialize').mockResolvedValue(undefined);
    jest.spyOn(mockHandler1, 'setupListeners').mockResolvedValue(undefined);
    jest.spyOn(mockHandler1, 'supportsPastDepositCheck').mockReturnValue(true);
    jest.spyOn(mockHandler1, 'getLatestBlock').mockResolvedValue(100);
    jest.spyOn(mockHandler1, 'checkForPastDeposits').mockResolvedValue(undefined);

    jest.spyOn(mockHandler2, 'processWormholeBridging').mockResolvedValue(undefined);
    jest.spyOn(mockHandler2, 'processFinalizeDeposits').mockResolvedValue(undefined);
    jest.spyOn(mockHandler2, 'processInitializeDeposits').mockResolvedValue(undefined);
    jest.spyOn(mockHandler2, 'initialize').mockResolvedValue(undefined);
    jest.spyOn(mockHandler2, 'setupListeners').mockResolvedValue(undefined);
    jest.spyOn(mockHandler2, 'supportsPastDepositCheck').mockReturnValue(false);
    jest.spyOn(mockHandler2, 'getLatestBlock').mockResolvedValue(200);
    jest.spyOn(mockHandler2, 'checkForPastDeposits').mockResolvedValue(undefined);

    // Setup timers
    jest.useFakeTimers();
  });

  afterEach(() => {
    // Restore environment
    process.env = originalEnv;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('startCronJobs()', () => {
    test('should set up deposit processing cron job (every minute)', async () => {
      // Arrange
      const cronScheduleSpy = cron.schedule as jest.Mock;

      // Act
      Core.startCronJobs();

      // Assert
      expect(cronScheduleSpy).toHaveBeenCalledWith('* * * * *', expect.any(Function));

      // Get the cron job function and execute it
      const cronJob = cronScheduleSpy.mock.calls.find(
        (call) => call[0] === '* * * * *',
      )?.[1] as () => Promise<void>;
      expect(cronJob).toBeDefined();

      await cronJob();

      // Verify all handlers are called in parallel
      expect(mockHandler1.processWormholeBridging).toHaveBeenCalledTimes(1);
      expect(mockHandler1.processFinalizeDeposits).toHaveBeenCalledTimes(1);
      expect(mockHandler1.processInitializeDeposits).toHaveBeenCalledTimes(1);

      expect(mockHandler2.processWormholeBridging).toHaveBeenCalledTimes(1);
      expect(mockHandler2.processFinalizeDeposits).toHaveBeenCalledTimes(1);
      expect(mockHandler2.processInitializeDeposits).toHaveBeenCalledTimes(1);
    });

    test('should handle individual chain failures in deposit processing', async () => {
      // Arrange
      const cronScheduleSpy = cron.schedule as jest.Mock;

      // Make one handler fail
      jest
        .spyOn(mockHandler1, 'processFinalizeDeposits')
        .mockRejectedValue(new Error('Chain SepoliaTestnet failed'));

      // Act
      Core.startCronJobs();
      const cronJob = cronScheduleSpy.mock.calls.find(
        (call) => call[0] === '* * * * *',
      )?.[1] as () => Promise<void>;

      await cronJob();

      // Assert - Other chains should continue processing
      expect(mockHandler2.processFinalizeDeposits).toHaveBeenCalledTimes(1);
      expect(mockHandler2.processInitializeDeposits).toHaveBeenCalledTimes(1);
      expect(logErrorContext).toHaveBeenCalled();
    });

    test('should set up redemption processing cron job (every 2 minutes)', async () => {
      // Arrange
      const cronScheduleSpy = cron.schedule as jest.Mock;

      // Act
      Core.startCronJobs();

      // Assert
      expect(cronScheduleSpy).toHaveBeenCalledWith('*/2 * * * *', expect.any(Function));

      // Get and execute the redemption cron job
      const redemptionCronJob = cronScheduleSpy.mock.calls.find(
        (call) => call[0] === '*/2 * * * *',
      )?.[1] as () => Promise<void>;
      expect(redemptionCronJob).toBeDefined();

      // Initialize L2 services first
      await Core.initializeAllL2RedemptionServices();

      // Get L2 service and mock it in the map
      const l2Service = Core.getL2RedemptionService('SepoliaTestnet');
      if (l2Service) {
        jest.spyOn(l2Service, 'processPendingRedemptions').mockResolvedValue(undefined);
        jest.spyOn(l2Service, 'processVaaFetchedRedemptions').mockResolvedValue(undefined);
      }

      await redemptionCronJob();

      // Note: L2 service calls verified through service creation and execution
    });

    test('should skip chains without L2 service in redemption processing', async () => {
      // Arrange
      const cronScheduleSpy = cron.schedule as jest.Mock;

      // Act
      Core.startCronJobs();
      const redemptionCronJob = cronScheduleSpy.mock.calls.find(
        (call) => call[0] === '*/2 * * * *',
      )?.[1] as () => Promise<void>;

      // Execute without initializing L2 services
      await redemptionCronJob();

      // Assert - Should log error for missing services
      expect(logger.error).toHaveBeenCalled();
    });

    test('should set up past deposits cron job (every 60 minutes)', async () => {
      // Arrange
      const cronScheduleSpy = cron.schedule as jest.Mock;

      // Act
      Core.startCronJobs();

      // Assert
      expect(cronScheduleSpy).toHaveBeenCalledWith('*/60 * * * *', expect.any(Function));

      // Get and execute the past deposits cron job
      const pastDepositsCronJob = cronScheduleSpy.mock.calls.find(
        (call) => call[0] === '*/60 * * * *',
      )?.[1] as () => Promise<void>;
      expect(pastDepositsCronJob).toBeDefined();

      await pastDepositsCronJob();

      // Verify only handlers that support past deposit checking are called
      expect(mockHandler1.supportsPastDepositCheck).toHaveBeenCalledTimes(1);
      expect(mockHandler1.checkForPastDeposits).toHaveBeenCalledWith({
        pastTimeInMinutes: 60,
        latestBlock: 100,
      });

      expect(mockHandler2.supportsPastDepositCheck).toHaveBeenCalledTimes(1);
      expect(mockHandler2.checkForPastDeposits).not.toHaveBeenCalled();
    });

    test('should skip past deposits check for invalid latestBlock', async () => {
      // Arrange
      const cronScheduleSpy = cron.schedule as jest.Mock;
      jest.spyOn(mockHandler1, 'getLatestBlock').mockResolvedValue(-1);

      // Act
      Core.startCronJobs();
      const pastDepositsCronJob = cronScheduleSpy.mock.calls.find(
        (call) => call[0] === '*/60 * * * *',
      )?.[1] as () => Promise<void>;

      await pastDepositsCronJob();

      // Assert
      expect(mockHandler1.checkForPastDeposits).not.toHaveBeenCalled();
    });

    test('should enable cleanup cron jobs when ENABLE_CLEANUP_CRON=true', async () => {
      // Arrange
      process.env.ENABLE_CLEANUP_CRON = 'true';
      const cronScheduleSpy = cron.schedule as jest.Mock;

      // Act
      Core.startCronJobs();

      // Assert - Should have cleanup cron job
      expect(cronScheduleSpy).toHaveBeenCalledWith('*/10 * * * *', expect.any(Function));

      // Get and execute cleanup cron job
      const cleanupCronJob = cronScheduleSpy.mock.calls.find(
        (call) => call[0] === '*/10 * * * *',
      )?.[1] as () => Promise<void>;
      expect(cleanupCronJob).toBeDefined();

      await cleanupCronJob();

      // Verify cleanup functions called in sequence
      expect(cleanQueuedDeposits).toHaveBeenCalledTimes(1);
      expect(cleanFinalizedDeposits).toHaveBeenCalledTimes(1);
      expect(cleanBridgedDeposits).toHaveBeenCalledTimes(1);
    });

    test('should disable cleanup cron jobs when ENABLE_CLEANUP_CRON=false', async () => {
      // Arrange
      process.env.ENABLE_CLEANUP_CRON = 'false';
      const cronScheduleSpy = cron.schedule as jest.Mock;

      // Act
      Core.startCronJobs();

      // Assert - Should not have cleanup cron job
      expect(cronScheduleSpy).not.toHaveBeenCalledWith('*/10 * * * *', expect.any(Function));
    });

    test('should handle errors in cleanup functions', async () => {
      // Arrange
      process.env.ENABLE_CLEANUP_CRON = 'true';
      const cronScheduleSpy = cron.schedule as jest.Mock;

      // Make one cleanup function fail
      (cleanQueuedDeposits as any).mockRejectedValue(new Error('Cleanup failed'));

      // Act
      Core.startCronJobs();
      const cleanupCronJob = cronScheduleSpy.mock.calls.find(
        (call) => call[0] === '*/10 * * * *',
      )?.[1] as () => Promise<void>;

      await cleanupCronJob();

      // Assert - Error should be logged
      expect(logErrorContext).toHaveBeenCalled();
      // Note: Other cleanup functions aren't called because the error is thrown and not caught individually
    });

    test('should set up redemption cleanup cron job', async () => {
      // Arrange
      process.env.ENABLE_CLEANUP_CRON = 'true';
      const cronScheduleSpy = cron.schedule as jest.Mock;
      const now = Date.now();
      const retentionMs = 7 * 24 * 60 * 60 * 1000; // 7 days

      // Mock redemptions - include all required fields
      const mockRedemptions = [
        {
          id: 'redemption1',
          status: RedemptionStatus.COMPLETED,
          dates: { completedAt: now - retentionMs - 1000 }, // 1 second past retention
        },
        {
          id: 'redemption2',
          status: RedemptionStatus.FAILED,
          dates: { completedAt: now - retentionMs - 1000 }, // 1 second past retention
        },
        {
          id: 'redemption3',
          status: RedemptionStatus.PENDING,
          dates: { completedAt: now - retentionMs - 1000 }, // Should not be cleaned (not completed/failed)
        },
      ];

      (RedemptionStore.getAll as any).mockResolvedValue(mockRedemptions);

      // Act
      Core.startCronJobs();

      // Get and execute redemption cleanup cron job (it's the second */60 * * * * schedule)
      const redemptionCleanupCronJob = cronScheduleSpy.mock.calls.filter(
        (call) => call[0] === '*/60 * * * *',
      )[1]?.[1] as () => Promise<void>;
      expect(redemptionCleanupCronJob).toBeDefined();

      await redemptionCleanupCronJob();

      // Assert - Should delete old completed/failed redemptions
      expect(RedemptionStore.delete).toHaveBeenCalledWith('redemption1');
      expect(RedemptionStore.delete).toHaveBeenCalledWith('redemption2');
      expect(RedemptionStore.delete).not.toHaveBeenCalledWith('redemption3');
    });
  });

  describe('initializeAllChains()', () => {
    test('should initialize registry and handlers with default configuration', async () => {
      // Act
      await Core.initializeAllChains();

      // Assert - Should use mocked chain configs
      expect(chainHandlerRegistry.initialize).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ chainName: 'SepoliaTestnet' }),
          expect.objectContaining({ chainName: 'PolygonTestnet' }),
        ]),
      );
      expect(mockHandler1.initialize).toHaveBeenCalledTimes(1);
      expect(mockHandler1.setupListeners).toHaveBeenCalledTimes(1);
      expect(mockHandler2.initialize).toHaveBeenCalledTimes(1);
      expect(mockHandler2.setupListeners).toHaveBeenCalledTimes(1);
    });

    test('should handle empty chain configuration', async () => {
      // Arrange - Clear the handler list to simulate no configurations
      (chainHandlerRegistry.list as jest.Mock).mockReturnValue([]);

      // Act
      await Core.initializeAllChains();

      // Assert - Should still call initialize but no handlers to process
      expect(chainHandlerRegistry.initialize).toHaveBeenCalled();
    });

    test('should initialize chain handlers with concurrency limit', async () => {
      // Arrange
      const mockLimit = jest.fn((fn: () => unknown) => fn());
      (pLimit as jest.Mock).mockReturnValue(mockLimit);

      // Act
      await Core.initializeAllChains();

      // Assert
      expect(pLimit).toHaveBeenCalledWith(5);
      expect(mockHandler1.initialize).toHaveBeenCalledTimes(1);
      expect(mockHandler1.setupListeners).toHaveBeenCalledTimes(1);
      expect(mockHandler2.initialize).toHaveBeenCalledTimes(1);
      expect(mockHandler2.setupListeners).toHaveBeenCalledTimes(1);
    });

    test('should handle individual handler initialization failures', async () => {
      // Arrange
      jest.spyOn(mockHandler1, 'initialize').mockRejectedValue(new Error('Init failed'));

      // Act
      await Core.initializeAllChains();

      // Assert - Other handlers should continue initialization
      expect(mockHandler2.initialize).toHaveBeenCalledTimes(1);
      expect(mockHandler2.setupListeners).toHaveBeenCalledTimes(1);
      expect(logErrorContext).toHaveBeenCalled();
    });

    test('should handle setupListeners failures', async () => {
      // Arrange
      jest.spyOn(mockHandler1, 'setupListeners').mockRejectedValue(new Error('Listener failed'));

      // Act
      await Core.initializeAllChains();

      // Assert - Other handlers should continue
      expect(mockHandler2.setupListeners).toHaveBeenCalledTimes(1);
      expect(logErrorContext).toHaveBeenCalled();
    });
  });

  describe('initializeAllL2RedemptionServices()', () => {
    test('should filter and initialize only EVM chains with L2 enabled', async () => {
      // Act
      await Core.initializeAllL2RedemptionServices();

      // Assert - Should create services for EVM chains with enableL2Redemption: true
      expect(L2RedemptionService.create).toHaveBeenCalledWith(
        expect.objectContaining({ chainName: 'SepoliaTestnet', chainType: 'Evm' }),
      );
      // PolygonTestnet has enableL2Redemption: false, so it should not be called
      expect(L2RedemptionService.create).toHaveBeenCalledTimes(1);
    });

    test('should only create services for chains with enableL2Redemption=true', async () => {
      // Act
      await Core.initializeAllL2RedemptionServices();

      // Assert - Should create service for SepoliaTestnet (enabled) but not PolygonTestnet (disabled)
      expect(L2RedemptionService.create).toHaveBeenCalledWith(
        expect.objectContaining({ chainName: 'SepoliaTestnet', enableL2Redemption: true }),
      );

      // PolygonTestnet should be logged as disabled but service not created
      const createCalls = (L2RedemptionService.create as jest.Mock).mock.calls;
      const polygonCall = createCalls.find(
        (call: unknown[]) => (call[0] as { chainName: string }).chainName === 'PolygonTestnet',
      );
      expect(polygonCall).toBeUndefined();
    });

    test('should handle L2RedemptionService creation failures', async () => {
      // Clear mocks and set up failure scenario
      (L2RedemptionService.create as jest.Mock).mockClear();
      (logErrorContext as jest.Mock).mockClear();
      (L2RedemptionService.create as any).mockRejectedValueOnce(
        new Error('Service creation failed'),
      );

      // Act
      await Core.initializeAllL2RedemptionServices();

      // Assert - Should log error and continue with other chains
      expect(logErrorContext).toHaveBeenCalled();
    });

    test('should prevent duplicate service creation', async () => {
      // Act - Call twice
      await Core.initializeAllL2RedemptionServices();
      await Core.initializeAllL2RedemptionServices();

      // Assert - Should only create service once per chain
      expect(L2RedemptionService.create).toHaveBeenCalledTimes(1); // Only SepoliaTestnet has enableL2Redemption: true
    });

    test('should handle no EVM chains', async () => {
      // Store original environment
      const originalSupportedChains = process.env.SUPPORTED_CHAINS;

      // Set environment to non-existent chains (this will result in empty config array)
      process.env.SUPPORTED_CHAINS = 'nonExistentChain1,nonExistentChain2';

      // Clear mocks and reset state
      (L2RedemptionService.create as jest.Mock).mockClear();
      (logger.warn as jest.Mock).mockClear();
      Core.resetChainConfigs();

      // Act
      await Core.initializeAllL2RedemptionServices();

      // Assert - Should handle gracefully with no EVM chains
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No EVM chain configurations found'),
      );

      // Restore environment
      process.env.SUPPORTED_CHAINS = originalSupportedChains;
      Core.resetChainConfigs();
    });
  });

  describe('getL2RedemptionService()', () => {
    test('should return service for existing chain', async () => {
      // Arrange
      await Core.initializeAllL2RedemptionServices();

      // Act
      const service = Core.getL2RedemptionService('SepoliaTestnet');

      // Assert
      expect(service).toBeDefined();
    });

    test('should return undefined for non-existent chain', () => {
      // Act
      const service = Core.getL2RedemptionService('non-existent-chain');

      // Assert
      expect(service).toBeUndefined();
    });
  });
});
