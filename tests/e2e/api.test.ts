import request from 'supertest';
import express from 'express';
import { Router } from 'express';
import { ethers } from 'ethers';
import { EndpointController } from '../../controllers/Endpoint.controller';
import { MockChainHandler } from '../mocks/MockChainHandler';
import { createTestDeposit } from '../mocks/BlockchainMock';

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
  
  describe('POST /api/reveal', () => {
    test('should return 200 and deposit ID for valid data', async () => {
      // Create test data
      const revealData = {
        fundingTx: {
          txHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
          outputIndex: 0,
          value: ethers.utils.parseEther('0.1').toString(),
        },
        reveal: [
          ethers.utils.hexlify(ethers.utils.randomBytes(32)),
          ethers.utils.hexlify(ethers.utils.randomBytes(32)),
          ethers.utils.hexlify(ethers.utils.randomBytes(20)),
          ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        ],
        l2DepositOwner: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
        l2Sender: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
      };
      
      // Send request
      const response = await request(app)
        .post('/api/reveal')
        .send(revealData)
        .set('Content-Type', 'application/json');
      
      // Check response
      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({
          success: true,
          depositId: expect.any(String),
          message: 'Deposit initialized successfully',
        })
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
        })
      );
    });
  });
  
  describe('GET /api/deposit/:depositId', () => {
    test('should return 200 and deposit status for valid ID', async () => {
      // Create test deposit and add it to the chain handler
      const testDeposit = createTestDeposit({
        status: 'INITIALIZED',
      });
      mockChainHandler.addDeposit(testDeposit);
      
      // Send request
      const response = await request(app).get(`/api/deposit/${testDeposit.id}`);
      
      // Check response
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        depositId: testDeposit.id,
        status: 1, // INITIALIZED
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
      // 1. Create and submit a new deposit
      const revealData = {
        fundingTx: {
          txHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
          outputIndex: 0,
          value: ethers.utils.parseEther('0.1').toString(),
        },
        reveal: [
          ethers.utils.hexlify(ethers.utils.randomBytes(32)),
          ethers.utils.hexlify(ethers.utils.randomBytes(32)),
          ethers.utils.hexlify(ethers.utils.randomBytes(20)),
          ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        ],
        l2DepositOwner: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
        l2Sender: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
      };
      
      // Submit the deposit
      const createResponse = await request(app)
        .post('/api/reveal')
        .send(revealData)
        .set('Content-Type', 'application/json');
      
      // Check if deposit was created successfully
      expect(createResponse.status).toBe(200);
      expect(createResponse.body.success).toBe(true);
      
      const depositId = createResponse.body.depositId;
      
      // 2. Check initial status (should be INITIALIZED after endpoint handling)
      const initialStatusResponse = await request(app).get(`/api/deposit/${depositId}`);
      
      // The status should be INITIALIZED since initializeDeposit is called in handleReveal
      expect(initialStatusResponse.status).toBe(200);
      expect(initialStatusResponse.body.status).toBe(1); // INITIALIZED
      
      // 3. Manually trigger finalization (in a real scenario, this would happen via the cron job)
      const deposit = mockChainHandler.getDeposit(depositId);
      if (deposit) {
        await mockChainHandler.finalizeDeposit(deposit);
      }
      
      // 4. Check final status (should be FINALIZED)
      const finalStatusResponse = await request(app).get(`/api/deposit/${depositId}`);
      
      expect(finalStatusResponse.status).toBe(200);
      expect(finalStatusResponse.body.status).toBe(2); // FINALIZED
    });
  });
}); 