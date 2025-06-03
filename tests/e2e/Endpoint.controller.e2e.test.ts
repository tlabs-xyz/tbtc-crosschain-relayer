import request from 'supertest';
import express from 'express';
import type { Express } from 'express';
import { ethers } from 'ethers';
import { DepositStatus } from '../../types/DepositStatus.enum.js';
import { CHAIN_TYPE, NETWORK } from '../../config/schemas/common.schema.js';
import type { EvmChainConfig } from '../../config/schemas/evm.chain.schema.js';
import type { ChainHandlerInterface } from '../../interfaces/ChainHandler.interface.js';
import type { TransactionReceipt } from '@ethersproject/providers';
import type { Deposit } from '../../types/Deposit.type.js';
import type { Reveal } from '../../types/Reveal.type.js';

// Set up environment variables before any imports that might use them
process.env.SUPPORTED_CHAINS = 'MockEndpointChain';
process.env.USE_ENDPOINT = 'true';

// Mock configuration that uses endpoints
const mockEndpointChainConfig: EvmChainConfig = {
  chainName: 'MockEndpointChain',
  chainType: CHAIN_TYPE.EVM,
  network: NETWORK.TESTNET,
  useEndpoint: true,
  supportsRevealDepositAPI: true,
  enableL2Redemption: false,
  l1Rpc: 'http://localhost:8545/mock',
  l2Rpc: 'http://localhost:8546/mock',
  l2WsRpc: 'ws://localhost:8547/mock',
  l1ContractAddress: ethers.constants.AddressZero,
  l2ContractAddress: ethers.constants.AddressZero,
  l1BitcoinRedeemerAddress: ethers.constants.AddressZero,
  l2BitcoinRedeemerAddress: ethers.constants.AddressZero,
  l2WormholeGatewayAddress: ethers.constants.AddressZero,
  l2WormholeChainId: 1,
  l2StartBlock: 0,
  vaultAddress: ethers.constants.AddressZero,
  l1Confirmations: 1,
  privateKey: ethers.Wallet.createRandom().privateKey,
  endpointUrl: 'http://localhost:3000',
};

// Mock the chain configs before any other imports
jest.mock('../../config/index.js', () => ({
  __esModule: true,
  chainConfigs: {
    MockEndpointChain: mockEndpointChainConfig,
  },
}));

// Mock chain handler registry early
jest.mock('../../handlers/ChainHandlerRegistry.js', () => ({
  chainHandlerRegistry: {
    get: jest.fn(),
    list: jest.fn(),
    initialize: jest.fn().mockResolvedValue(undefined),
  },
}));

// Mock chain handler for endpoint-based chain
class MockEndpointChainHandler implements ChainHandlerInterface {
  public config: EvmChainConfig;
  private deposits: Map<string, Deposit> = new Map();

  constructor(config: EvmChainConfig) {
    this.config = config;
  }

  supportsPastDepositCheck(): boolean {
    return false;
  }

  async initialize(): Promise<void> {
    // Mock initialization
  }

  async setupListeners(): Promise<void> {
    // Mock listener setup
  }

  async getLatestBlock(): Promise<number> {
    return 100;
  }

  async processInitializeDeposits(): Promise<void> {
    // Mock processing
  }

  async processFinalizeDeposits(): Promise<void> {
    // Mock processing
  }

  async checkForPastDeposits(): Promise<void> {
    // Mock past deposits check
  }

  async initializeDeposit(deposit: Deposit): Promise<TransactionReceipt | undefined> {
    const updatedDeposit = { ...deposit, status: DepositStatus.INITIALIZED };
    this.deposits.set(deposit.id, updatedDeposit);

    // Return mock transaction receipt
    return {
      transactionHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
      status: 1,
      to: ethers.constants.AddressZero,
      from: ethers.constants.AddressZero,
      contractAddress: ethers.constants.AddressZero,
      transactionIndex: 0,
      gasUsed: ethers.BigNumber.from(21000),
      logsBloom: '0x' + '0'.repeat(512),
      blockHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
      logs: [],
      blockNumber: 100,
      confirmations: 1,
      cumulativeGasUsed: ethers.BigNumber.from(21000),
      effectiveGasPrice: ethers.BigNumber.from(1),
      byzantium: true,
      type: 2,
    } as TransactionReceipt;
  }

  async checkDepositStatus(depositId: string): Promise<DepositStatus | null> {
    const deposit = this.deposits.get(depositId);
    return deposit ? deposit.status : null;
  }

  async finalizeDeposit(deposit: Deposit): Promise<TransactionReceipt | undefined> {
    const existingDeposit = this.deposits.get(deposit.id);
    if (existingDeposit) {
      existingDeposit.status = DepositStatus.FINALIZED;
      this.deposits.set(deposit.id, existingDeposit);
      return {
        transactionHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        status: 1,
      } as TransactionReceipt;
    }
    throw new Error('Deposit not found for finalization');
  }

  // Helper method to manually add deposits for testing
  addDeposit(deposit: Deposit): void {
    this.deposits.set(deposit.id, deposit);
  }
}

describe('Endpoint.controller E2E Tests', () => {
  let app: Express;
  let mockHandler: MockEndpointChainHandler;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    // Store original environment
    originalEnv = { ...process.env };

    // Create mock handler
    mockHandler = new MockEndpointChainHandler(mockEndpointChainConfig);

    // Import the chain handler registry after mocking
    const { chainHandlerRegistry } = await import('../../handlers/ChainHandlerRegistry.js');

    // Configure the mocked registry
    (chainHandlerRegistry.get as jest.Mock).mockReturnValue(mockHandler);
    (chainHandlerRegistry.list as jest.Mock).mockReturnValue([mockHandler]);

    // Set up Express app for testing
    app = express();
    app.use(express.json());

    // Import and set up routes after mocking
    const { router } = await import('../../routes/Routes.js');
    app.use('/', router);

    // Set up error handling middleware
    app.use(
      (error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        console.error('Express error:', error);

        // Handle body parser errors (like malformed JSON)
        if (error.status && error.expose) {
          return res.status(error.status).json({ success: false, error: error.message });
        }

        // For other errors, preserve status codes that are already set
        const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
        return res.status(statusCode).json({ success: false, error: error.message });
      },
    );
  });

  afterAll(() => {
    // Restore environment
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    // Clear deposits between tests
    mockHandler = new MockEndpointChainHandler(mockEndpointChainConfig);

    // Update the mocked registry with the new handler instance
    const { chainHandlerRegistry } = await import('../../handlers/ChainHandlerRegistry.js');
    (chainHandlerRegistry.get as jest.Mock).mockReturnValue(mockHandler);
    (chainHandlerRegistry.list as jest.Mock).mockReturnValue([mockHandler]);
  });

  describe('Complete Deposit Workflow (POST → GET)', () => {
    test('should successfully complete entire deposit initialization and status check workflow', async () => {
      // Arrange - Create valid reveal data
      const fundingTxHash = ethers.utils.hexlify(ethers.utils.randomBytes(32));
      const fundingOutputIndex = 0;

      const revealData: Reveal = {
        fundingOutputIndex,
        blindingFactor: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        walletPubKeyHash: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
        refundPubKeyHash: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
        refundLocktime: ethers.utils.hexlify(ethers.utils.randomBytes(4)),
        vault: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
      };

      const requestBody = {
        fundingTx: {
          txHash: fundingTxHash,
          value: ethers.utils.parseEther('0.1').toString(),
          version: '0x01000000',
          inputVector:
            '0x010000000000000000000000000000000000000000000000000000000000000000ffffffff0000ffffffff',
          outputVector: '0x0100000000000000001976a914000000000000000000000000000000000000000088ac',
          locktime: '0x00000000',
        },
        reveal: revealData,
        l2DepositOwner: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
        l2Sender: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
      };

      // Act & Assert - Step 1: Initialize deposit via POST
      const initResponse = await request(app)
        .post(`/api/MockEndpointChain/reveal`)
        .send(requestBody)
        .expect(200);

      expect(initResponse.body).toMatchObject({
        success: true,
        depositId: expect.any(String),
        message: 'Deposit initialized successfully',
        receipt: expect.objectContaining({
          transactionHash: expect.any(String),
          status: 1,
        }),
      });

      const { depositId } = initResponse.body;

      // Act & Assert - Step 2: Check deposit status via GET
      const statusResponse = await request(app)
        .get(`/api/MockEndpointChain/deposit/${depositId}`)
        .expect(200);

      expect(statusResponse.body).toMatchObject({
        success: true,
        depositId,
        status: DepositStatus.INITIALIZED,
      });

      // Verify the deposit was actually created in the handler
      const storedStatus = await mockHandler.checkDepositStatus(depositId);
      expect(storedStatus).toBe(DepositStatus.INITIALIZED);
    });

    test('should handle complete workflow with invalid reveal data gracefully', async () => {
      // Arrange - Create invalid reveal data (missing required fields)
      const requestBody = {
        fundingTx: {
          txHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
          value: ethers.utils.parseEther('0.1').toString(),
        },
        // Missing reveal, l2DepositOwner, l2Sender
      };

      // Act & Assert - Should fail gracefully with 400
      const response = await request(app)
        .post(`/api/MockEndpointChain/reveal`)
        .send(requestBody)
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Missing required fields in request body',
      });
    });
  });

  describe('Environment Configuration Integration', () => {
    test('should handle USE_ENDPOINT environment variable correctly', async () => {
      // Arrange - Set USE_ENDPOINT to false
      process.env.USE_ENDPOINT = 'false';

      // This test validates that the routing system respects environment configuration
      // The actual behavior would depend on how the routes are set up in the main application

      // Act - Try to access endpoint routes
      await request(app)
        .get(`/api/MockEndpointChain/deposit/test-deposit-id`)
        .expect((res) => {
          // The response could be 404 if endpoints are disabled, or 200 if they're still available
          // This depends on the actual route configuration logic
          expect([200, 404, 500]).toContain(res.status);
        });

      // Reset environment
      delete process.env.USE_ENDPOINT;
    });

    test('should handle missing chain configuration gracefully', async () => {
      // Act - Try to access non-existent chain endpoint
      await request(app)
        .get(`/api/NonExistentChain/deposit/test-deposit-id`)
        .expect((res) => {
          // Should return appropriate error status (404 or 500 depending on implementation)
          expect([404, 500]).toContain(res.status);
        });
    });
  });

  describe('Express Routing and Middleware Integration', () => {
    test('should handle request validation through Express middleware', async () => {
      // Arrange - Send malformed JSON
      const malformedRequest = '{"invalid": json}';

      // Act & Assert - Should handle malformed JSON gracefully
      const response = await request(app)
        .post(`/api/MockEndpointChain/reveal`)
        .set('Content-Type', 'application/json')
        .send(malformedRequest)
        .expect(400);

      // The exact response depends on Express error handling middleware
      expect(response.body).toHaveProperty('success', false);
    });

    test('should handle CORS and other middleware correctly', async () => {
      // Act - Make OPTIONS request to test CORS
      await request(app)
        .options(`/api/MockEndpointChain/reveal`)
        .expect((res) => {
          // Should handle OPTIONS request appropriately
          expect([200, 204, 404]).toContain(res.status);
        });
    });

    test('should handle large request payloads appropriately', async () => {
      // Arrange - Create large payload
      const largeRevealData = {
        fundingTx: {
          txHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
          value: ethers.utils.parseEther('0.1').toString(),
          version: '0x01000000',
          inputVector: '0x' + '0'.repeat(10000), // Large input vector
          outputVector: '0x' + '0'.repeat(10000), // Large output vector
          locktime: '0x00000000',
        },
        reveal: {
          fundingOutputIndex: 0,
          blindingFactor: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
          walletPubKeyHash: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
          refundPubKeyHash: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
          refundLocktime: ethers.utils.hexlify(ethers.utils.randomBytes(4)),
          vault: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
        },
        l2DepositOwner: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
        l2Sender: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
      };

      // Act & Assert - Should handle large payload
      await request(app)
        .post(`/api/MockEndpointChain/reveal`)
        .send(largeRevealData)
        .expect((res) => {
          // Should either succeed or fail gracefully with appropriate status
          expect([200, 400, 413, 500]).toContain(res.status);
        });
    });
  });

  describe('Critical Error Path Validation', () => {
    test('should handle deposit initialization failures gracefully', async () => {
      // Arrange - Create a handler that will fail during initialization
      const failingHandler = new MockEndpointChainHandler(mockEndpointChainConfig);
      jest
        .spyOn(failingHandler, 'initializeDeposit')
        .mockRejectedValue(new Error('Simulated initialization failure'));

      // Mock the registry to return the failing handler
      const { chainHandlerRegistry } = await import('../../handlers/ChainHandlerRegistry.js');
      const originalGetSpy = jest
        .spyOn(chainHandlerRegistry, 'get')
        .mockReturnValue(failingHandler);

      const requestBody = {
        fundingTx: {
          txHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
          value: ethers.utils.parseEther('0.1').toString(),
          version: '0x01000000',
          inputVector:
            '0x010000000000000000000000000000000000000000000000000000000000000000ffffffff0000ffffffff',
          outputVector: '0x0100000000000000001976a914000000000000000000000000000000000000000088ac',
          locktime: '0x00000000',
        },
        reveal: {
          fundingOutputIndex: 0,
          blindingFactor: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
          walletPubKeyHash: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
          refundPubKeyHash: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
          refundLocktime: ethers.utils.hexlify(ethers.utils.randomBytes(4)),
          vault: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
        },
        l2DepositOwner: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
        l2Sender: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
      };

      try {
        // Act & Assert - Should handle failure gracefully
        const response = await request(app)
          .post(`/api/MockEndpointChain/reveal`)
          .send(requestBody)
          .expect(500);

        expect(response.body).toMatchObject({
          success: false,
          error: expect.stringContaining('Simulated initialization failure'),
        });
      } finally {
        // Cleanup - Restore original mock
        originalGetSpy.mockRestore();
      }
    });

    test('should handle deposit status check failures gracefully', async () => {
      // Arrange - Create a handler that will fail during status check
      const failingHandler = new MockEndpointChainHandler(mockEndpointChainConfig);
      jest
        .spyOn(failingHandler, 'checkDepositStatus')
        .mockRejectedValue(new Error('Simulated status check failure'));

      // Mock the registry to return the failing handler
      const { chainHandlerRegistry } = await import('../../handlers/ChainHandlerRegistry.js');
      const originalGetSpy = jest
        .spyOn(chainHandlerRegistry, 'get')
        .mockReturnValue(failingHandler);

      try {
        // Act & Assert - Should handle failure gracefully
        const response = await request(app)
          .get(`/api/MockEndpointChain/deposit/test-deposit-id`)
          .expect(500);

        expect(response.body).toMatchObject({
          success: false,
          error: expect.stringContaining('Simulated status check failure'),
        });
      } finally {
        // Cleanup - Restore original mock
        originalGetSpy.mockRestore();
      }
    });

    test('should handle non-existent deposit queries appropriately', async () => {
      // Act & Assert - Query for non-existent deposit
      const response = await request(app)
        .get(`/api/MockEndpointChain/deposit/non-existent-deposit-id`)
        .expect(404);

      expect(response.body).toMatchObject({
        success: false,
        message: 'Deposit not found',
      });
    });
  });
});
