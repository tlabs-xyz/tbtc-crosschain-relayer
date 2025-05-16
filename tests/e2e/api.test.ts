import request from 'supertest';
import express from 'express';
import { Router } from 'express';
import { ethers } from 'ethers';
import { EndpointController } from '../../controllers/Endpoint.controller';
import { MockChainHandler } from '../mocks/MockChainHandler';
import { createTestDeposit } from '../mocks/BlockchainMock';
import { DepositStatus } from '../../types/DepositStatus.enum';

// Mock environment variables
process.env.USE_ENDPOINT = 'true';

describe('API Endpoints', () => {
  let app: express.Application;
  let mockChainHandler: MockChainHandler;
  let router: Router;

  beforeEach(() => {
    // Create a new express app for each test
    app = express();
    app.use(express.json());

    // Create a new MockChainHandler
    mockChainHandler = new MockChainHandler();

    // Create router with endpoints
    router = Router();

    // Default route
    router.get('/', (req, res) => {
      res.status(200).json({ message: 'API is running' });
    });

    // Status route
    router.get('/status', (req, res) => {
      res.status(200).json({ status: 'OK' });
    });

    // Reveal endpoint
    router.post('/api/reveal', (req, res) => {
      const endpointController = new EndpointController(mockChainHandler);
      return endpointController.handleReveal(req, res);
    });

    // Deposit status endpoint
    router.get('/api/deposit/:depositId', (req, res) => {
      const endpointController = new EndpointController(mockChainHandler);
      return endpointController.getDepositStatus(req, res);
    });

    // Use router
    app.use(router);
  });

  describe('GET /', () => {
    test('should return 200 and a welcome message', async () => {
      const response = await request(app).get('/');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: 'API is running' });
    });
  });

  describe('GET /status', () => {
    test('should return 200 and status OK', async () => {
      const response = await request(app).get('/status');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'OK' });
    });
  });

  // Test data for reveal endpoint
  const validRevealData = {
    fundingTx: {
      txHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)), // This is NOT the BTC tx hash, just placeholder data
      outputIndex: 0,
      value: ethers.utils.parseEther('0.1').toString(),
      // --- Add missing fields required by serializeTransaction ---
      version: '0x01000000', // Example version
      inputVector:
        '0x010000000000000000000000000000000000000000000000000000000000000000ffffffff0000ffffffff', // Example input vector
      outputVector: '0x0100000000000000001976a914000000000000000000000000000000000000000088ac', // Example output vector
      locktime: '0x00000000', // Example locktime
      // --- End of added fields ---
    },
    reveal: [
      0, // fundingOutputIndex
      ethers.utils.hexlify(ethers.utils.randomBytes(32)), // blindingFactor
      ethers.utils.hexlify(ethers.utils.randomBytes(20)), // walletPublicKeyHash
      ethers.utils.hexlify(ethers.utils.randomBytes(20)), // refundPublicKeyHash
      ethers.utils.hexlify(ethers.utils.randomBytes(4)), // refundLocktime (uint32)
      '0x', // extraData
    ],
    l2DepositOwner: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
    l2Sender: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
  };

  describe('POST /api/reveal', () => {
    test('should return 200 and deposit ID for valid data', async () => {
      const response = await request(app).post('/api/reveal').send(validRevealData); // Use the updated test data

      // Check response
      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({
          success: true,
          depositId: expect.any(String),
          message: 'Deposit initialized successfully',
        }),
      );
    });

    test('should return 400 for missing required fields', async () => {
      // Create test data with missing fields
      const incompleteRevealData = {
        fundingTx: {
          txHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
          outputIndex: 0,
          value: ethers.utils.parseEther('0.1').toString(),
        },
        // Missing reveal, l2DepositOwner, l2Sender
      };

      // Send request
      const response = await request(app)
        .post('/api/reveal')
        .send(incompleteRevealData)
        .set('Content-Type', 'application/json');

      // Check response
      expect(response.status).toBe(400);
      expect(response.body).toEqual(
        expect.objectContaining({
          success: false,
          error: 'Missing required fields in request body',
        }),
      );
    });
  });

  describe('GET /api/deposit/:depositId', () => {
    test('should return 200 and deposit status for valid ID', async () => {
      // Arrange: Create a test deposit WITH NUMERIC STATUS
      const testDeposit = createTestDeposit({
        status: DepositStatus.INITIALIZED,
      });

      // Add deposit to the mock handler
      mockChainHandler.addDeposit(testDeposit);

      // Act: Make the API request
      const response = await request(app).get(`/api/deposit/${testDeposit.id}`);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        depositId: testDeposit.id,
        status: DepositStatus.INITIALIZED,
      });
    });

    test('should return 400 for missing deposit ID', async () => {
      // Send request with empty deposit ID
      const response = await request(app).get('/api/deposit/');

      // Check response - should be 404 since the route doesn't match
      expect(response.status).toBe(404);
    });
  });

  // Test full workflow: deposit creation -> initialization -> finalization
  describe('Full deposit lifecycle', () => {
    test('should process a deposit through the complete lifecycle', async () => {
      // 1. Create deposit via /api/reveal
      const createResponse = await request(app).post('/api/reveal').send(validRevealData); // Use the updated test data

      // Check if deposit was created successfully
      expect(createResponse.status).toBe(200);
      expect(createResponse.body.success).toBe(true);

      const depositId = createResponse.body.depositId;
      expect(depositId).toBeDefined();

      // 2. Check status via /api/deposit/:depositId
      const statusResponse = await request(app).get(`/api/deposit/${depositId}`);
      expect(statusResponse.status).toBe(200);
      // Initially, it should be QUEUED (or INITIALIZED if processed quickly)
      expect([0, 1]).toContain(statusResponse.body.status);

      // TODO: Add steps to simulate initialization and finalization if needed for full lifecycle test
    });
  });
});
