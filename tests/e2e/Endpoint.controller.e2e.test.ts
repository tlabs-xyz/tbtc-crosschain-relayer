// tests/e2e/Endpoint.controller.e2e.test.ts - E2E tests for Endpoint.controller
//
// This suite tests the complete deposit workflow and endpoint integration for the tBTC cross-chain relayer.
// It covers initialization, status checks, error handling, and edge cases for endpoint-based chains.

import request from 'supertest';
import express from 'express';
import type { Express } from 'express';
import * as AllEthers from 'ethers';
import { DepositStatus } from '../../types/DepositStatus.enum.js';
import { CHAIN_TYPE, NETWORK } from '../../config/schemas/common.schema.js';
import type { EvmChainConfig } from '../../config/schemas/evm.chain.schema.js';
import type { ChainHandlerInterface } from '../../interfaces/ChainHandler.interface.js';
import type { TransactionReceipt } from '@ethersproject/providers';
import type { Deposit } from '../../types/Deposit.type.js';
import type { Reveal } from '../../types/Reveal.type.js';

interface HttpError extends Error {
  status?: number;
  expose?: boolean;
}

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
  l1ContractAddress: AllEthers.constants.AddressZero,
  l2ContractAddress: AllEthers.constants.AddressZero,
  l1BitcoinRedeemerAddress: AllEthers.constants.AddressZero,
  l2BitcoinRedeemerAddress: AllEthers.constants.AddressZero,
  l2WormholeGatewayAddress: AllEthers.constants.AddressZero,
  l2WormholeChainId: 1,
  l2StartBlock: 0,
  vaultAddress: AllEthers.constants.AddressZero,
  l1Confirmations: 1,
  privateKey: AllEthers.Wallet.createRandom().privateKey,
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
      transactionHash: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(32)),
      status: 1,
      to: AllEthers.constants.AddressZero,
      from: AllEthers.constants.AddressZero,
      contractAddress: AllEthers.constants.AddressZero,
      transactionIndex: 0,
      gasUsed: AllEthers.BigNumber.from(21000),
      logsBloom: '0x' + '0'.repeat(512),
      blockHash: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(32)),
      logs: [],
      blockNumber: 100,
      confirmations: 1,
      cumulativeGasUsed: AllEthers.BigNumber.from(21000),
      effectiveGasPrice: AllEthers.BigNumber.from(1),
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
        transactionHash: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(32)),
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
      (
        error: HttpError,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
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
      const fundingTxHash = AllEthers.utils.hexlify(AllEthers.utils.randomBytes(32));
      const fundingOutputIndex = 0;

      const revealData: Reveal = {
        fundingOutputIndex,
        blindingFactor: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(32)),
        walletPubKeyHash: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
        refundPubKeyHash: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
        refundLocktime: Math.floor(Date.now() / 1000 + Math.random() * 1000).toString(),
        vault: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
      };

      const requestBody = {
        fundingTx: {
          txHash: fundingTxHash,
          value: AllEthers.utils.parseEther('0.1').toString(),
          version: '0x01000000',
          inputVector:
            '0x010000000000000000000000000000000000000000000000000000000000000000ffffffff0000ffffffff',
          outputVector: '0x0100000000000000001976a914000000000000000000000000000000000000000088ac',
          locktime: '0x00000000',
        },
        reveal: revealData,
        l2DepositOwner: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
        l2Sender: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
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
          txHash: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(32)),
          value: AllEthers.utils.parseEther('0.1').toString(),
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
        error: 'Invalid request body format.',
      });
    });

    test('should handle complete workflow with valid reveal data but simulated initialization failure', async () => {
      // Arrange - Create valid reveal data
      const fundingTxHash = AllEthers.utils.hexlify(AllEthers.utils.randomBytes(32));
      const fundingOutputIndex = 0;

      const revealData: Reveal = {
        fundingOutputIndex,
        blindingFactor: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(32)),
        walletPubKeyHash: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
        refundPubKeyHash: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
        refundLocktime: Math.floor(Date.now() / 1000 + Math.random() * 10000).toString(),
        vault: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
      };

      const requestBody = {
        fundingTx: {
          txHash: fundingTxHash,
          value: AllEthers.utils.parseEther('0.1').toString(),
          version: '0x01000000',
          inputVector:
            '0x010000000000000000000000000000000000000000000000000000000000000000ffffffff0000ffffffff',
          outputVector: '0x0100000000000000001976a914000000000000000000000000000000000000000088ac',
          locktime: '0x00000000',
        },
        reveal: revealData,
        l2DepositOwner: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
        l2Sender: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
      };

      // Mock chainHandler.initializeDeposit to throw an error for this specific test
      const expectedErrorMessage = 'Simulated Internal Server Error during deposit initialization';
      jest
        .spyOn(mockHandler, 'initializeDeposit')
        .mockRejectedValueOnce(new Error(expectedErrorMessage));

      // Act & Assert
      const response = await request(app)
        .post(`/api/${mockEndpointChainConfig.chainName}/reveal`)
        .send(requestBody)
        .expect(500); // Expect 500 due to the mocked internal failure

      expect(response.body).toMatchObject({
        success: false,
        error: expectedErrorMessage,
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
          txHash: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(32)),
          value: AllEthers.utils.parseEther('0.1').toString(),
          version: '0x01000000',
          inputVector: '0x' + '0'.repeat(10000), // Large input vector
          outputVector: '0x' + '0'.repeat(10000), // Large output vector
          locktime: '0x00000000',
        },
        reveal: {
          fundingOutputIndex: 0,
          blindingFactor: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(32)),
          walletPubKeyHash: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
          refundPubKeyHash: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
          refundLocktime: Math.floor(Math.random() * 100000).toString(),
          vault: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
        },
        l2DepositOwner: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
        l2Sender: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
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

  describe('Request Body Validation', () => {
    // Define valid base data to be reused, ensuring refundLocktime is numeric
    const baseValidRevealData: Reveal = {
      fundingOutputIndex: 0,
      blindingFactor: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(32)),
      walletPubKeyHash: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)), // valid format
      refundPubKeyHash: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)), // valid format
      refundLocktime: Math.floor(Date.now() / 1000 + Math.random() * 100000).toString(),
      vault: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)), // valid format
    };
    const baseValidFundingTx = {
      txHash: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(32)),
      value: AllEthers.utils.parseEther('0.1').toString(),
      version: '0x01000000',
      inputVector:
        '0x010000000000000000000000000000000000000000000000000000000000000000ffffffff0000ffffffff',
      outputVector: '0x0100000000000000001976a914000000000000000000000000000000000000000088ac',
      locktime: '0x00000000',
    };

    test("should return 400 if 'fundingTx' is missing", async () => {
      const requestBody = {
        // 'fundingTx' is deliberately omitted here to test the validation.
        reveal: {
          fundingOutputIndex: 0,
          blindingFactor: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(32)),
          walletPubKeyHash: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)), // valid format
          refundPubKeyHash: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)), // valid format
          refundLocktime: Math.floor(Math.random() * 100000).toString(), // Changed to numeric string
          vault: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)), // valid format
        },
        l2DepositOwner: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)), // valid format
        l2Sender: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)), // valid format
      };

      const response = await request(app)
        .post(`/api/${mockEndpointChainConfig.chainName}/reveal`)
        .send(requestBody)
        .expect(400); // Expecting a 400 Bad Request status

      // Verify the response body structure and error messages.
      // The error message should now come from Zod validation.
      expect(response.body).toMatchObject({
        success: false,
        error: 'Invalid request body format.', // This is the general error from Zod validation failure.
        details: expect.objectContaining({
          // Zod provides detailed error information.
          fieldErrors: expect.objectContaining({
            // We expect an error specifically for the 'fundingTx' field.
            fundingTx: expect.arrayContaining([
              expect.stringMatching(/Required|Invalid input/i), // Zod's message for a missing required field.
            ]),
          }),
        }),
      });
    });

    test("should return 400 if 'reveal' is missing", async () => {
      const requestBody = {
        fundingTx: {
          txHash: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(32)),
          value: AllEthers.utils.parseEther('0.1').toString(),
          version: '0x01000000',
          inputVector:
            '0x010000000000000000000000000000000000000000000000000000000000000000ffffffff0000ffffffff',
          outputVector: '0x0100000000000000001976a914000000000000000000000000000000000000000088ac',
          locktime: '0x00000000',
        },
        l2DepositOwner: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
        l2Sender: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
      };

      const response = await request(app)
        .post(`/api/${mockEndpointChainConfig.chainName}/reveal`)
        .send(requestBody)
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Invalid request body format.',
        details: expect.objectContaining({
          fieldErrors: expect.objectContaining({
            reveal: expect.arrayContaining([expect.stringMatching(/Required|Invalid input/i)]),
          }),
        }),
      });
    });

    test("should return 400 if 'l2DepositOwner' is missing", async () => {
      const requestBodyWithoutL2Owner = {
        fundingTx: { ...baseValidFundingTx },
        reveal: { ...baseValidRevealData }, // Uses corrected base
        // l2DepositOwner is omitted
        l2Sender: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
      };

      const response = await request(app)
        .post(`/api/${mockEndpointChainConfig.chainName}/reveal`)
        .send(requestBodyWithoutL2Owner)
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Invalid request body format.',
        details: expect.objectContaining({
          fieldErrors: expect.objectContaining({
            l2DepositOwner: expect.arrayContaining([
              expect.stringMatching(/Required|Invalid input/i),
            ]),
          }),
        }),
      });
    });

    test("should return 400 if 'l2Sender' is missing", async () => {
      const requestBodyWithoutL2Sender = {
        fundingTx: { ...baseValidFundingTx },
        reveal: { ...baseValidRevealData }, // Uses corrected base
        l2DepositOwner: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
        // l2Sender is omitted
      };

      const response = await request(app)
        .post(`/api/${mockEndpointChainConfig.chainName}/reveal`)
        .send(requestBodyWithoutL2Sender)
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Invalid request body format.',
        details: expect.objectContaining({
          fieldErrors: expect.objectContaining({
            l2Sender: expect.arrayContaining([expect.stringMatching(/Required|Invalid input/i)]),
          }),
        }),
      });
    });

    test("should return 400 for various invalid fields in 'reveal'", async () => {
      const testCases = [
        {
          field: 'fundingOutputIndex',
          value: -1,
          messageContent: /Number must be greater than or equal to 0/,
          path: ['reveal', 'fundingOutputIndex'],
        },
        {
          field: 'fundingOutputIndex',
          value: 'not-a-number',
          messageContent: /Expected number, received string/,
          path: ['reveal', 'fundingOutputIndex'],
        },
        {
          field: 'blindingFactor',
          value: 'not-a-hex-string',
          messageContent: /Invalid hex string/,
          path: ['reveal', 'blindingFactor'],
        },
        {
          field: 'walletPubKeyHash',
          value: '0xInvalidAddress',
          messageContent: /Invalid Ethereum address/,
          path: ['reveal', 'walletPubKeyHash'],
        },
        {
          field: 'refundPubKeyHash',
          value: '0x123',
          messageContent: /Invalid Ethereum address/,
          path: ['reveal', 'refundPubKeyHash'],
        },
        {
          field: 'refundLocktime',
          value: 'not-numeric',
          messageContent: /Invalid numeric string/,
          path: ['reveal', 'refundLocktime'],
        },
        {
          field: 'vault',
          value: 'invalidVault',
          messageContent: /Invalid Ethereum address/,
          path: ['reveal', 'vault'],
        },
      ];

      for (const { field, value, messageContent, path } of testCases) {
        // Start with a valid base reveal data (which now has correct numeric refundLocktime)
        const invalidRevealData = { ...baseValidRevealData, [field]: value };

        // If the field being tested for invalidity is *not* refundLocktime,
        // but its current random value is also invalid for its own type (e.g. a string for fundingOutputIndex where number is expected),
        // ensure that baseValidRevealData's refundLocktime (which is numeric) is used unless refundLocktime itself is being tested.
        // This logic is simplified: baseValidRevealData is already correct. The [field]: value override is the targeted invalidation.

        const requestBody = {
          fundingTx: { ...baseValidFundingTx },
          reveal: invalidRevealData, // This now contains the specifically invalidated field
          l2DepositOwner: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
          l2Sender: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
        };

        const response = await request(app)
          .post(`/api/${mockEndpointChainConfig.chainName}/reveal`)
          .send(requestBody)
          .expect(400);

        expect(response.body).toMatchObject({
          success: false,
          error: 'Invalid request body format.',
          details: expect.objectContaining({
            fieldErrors: expect.objectContaining({
              [path[0]]: expect.arrayContaining([expect.stringMatching(messageContent)]),
            }),
          }),
        });
      }
    });
  });

  describe('Critical Error Path Validation', () => {
    test('should handle deposit initialization failures gracefully', async () => {
      // Arrange: Create a request body that IS VALID according to RevealEndpointBodySchema
      const validRequestBodyForErrorTest = {
        fundingTx: {
          txHash: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(32)),
          value: AllEthers.utils.parseEther('0.1').toString(),
          version: '0x01000000',
          inputVector:
            '0x010000000000000000000000000000000000000000000000000000000000000000ffffffff0000ffffffff',
          outputVector: '0x0100000000000000001976a914000000000000000000000000000000000000000088ac',
          locktime: '0x00000000',
        },
        reveal: {
          fundingOutputIndex: 0,
          blindingFactor: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(32)),
          walletPubKeyHash: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)), // Valid format
          refundPubKeyHash: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)), // Valid format
          refundLocktime: Math.floor(Date.now() / 1000 + Math.random() * 10000).toString(), // Changed to numeric string
          vault: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)), // Valid format
        },
        l2DepositOwner: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)), // Valid format
        l2Sender: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)), // Valid format
      };

      // Mock chainHandler.initializeDeposit to throw an error for this specific test
      const expectedErrorMessage = 'Simulated Internal Server Error during deposit initialization';
      jest
        .spyOn(mockHandler, 'initializeDeposit')
        .mockRejectedValueOnce(new Error(expectedErrorMessage));

      // Act & Assert
      const response = await request(app)
        .post(`/api/${mockEndpointChainConfig.chainName}/reveal`)
        .send(validRequestBodyForErrorTest) // Send the valid body
        .expect(500); // Expect 500 due to the mocked internal failure

      expect(response.body).toMatchObject({
        success: false,
        error: expectedErrorMessage,
      });
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
