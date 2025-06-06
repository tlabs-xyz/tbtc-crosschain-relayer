import type { Request, Response } from 'express';
import { EndpointController } from '../../../controllers/Endpoint.controller.js';
import { MockChainHandler } from '../../mocks/MockChainHandler.js';
import { createTestDeposit } from '../../mocks/BlockchainMock.js';
import { ethers } from 'ethers';
import { DepositStatus } from '../../../types/DepositStatus.enum.js';
import { DepositStore } from '../../../utils/DepositStore.js';
import { prisma } from '../../../utils/prisma.js';

// Mock DepositStore
jest.mock('../../../utils/DepositStore.js');

// Mock Express request and response
const mockRequest = () => {
  const req: Partial<Request> = {
    body: {},
    params: {},
  };
  return req as Request;
};

const mockResponse = () => {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as Response;
};

describe('EndpointController', () => {
  let endpointController: EndpointController;
  let mockChainHandler: MockChainHandler;
  let mockDepositStore: jest.Mocked<typeof DepositStore>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create a new MockChainHandler for each test
    mockChainHandler = new MockChainHandler();

    // Set processing delay to 0 for faster tests
    mockChainHandler.setProcessingDelay(0);

    // Create a new EndpointController with the MockChainHandler
    endpointController = new EndpointController(mockChainHandler);

    // Set up DepositStore mocks
    mockDepositStore = DepositStore as jest.Mocked<typeof DepositStore>;
    mockDepositStore.getById.mockResolvedValue(null); // Default: no existing deposit
    mockDepositStore.create.mockResolvedValue(); // Default: successful creation
  });

  afterEach(() => {
    // Reset jest mocks
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    // Clean shutdown
    try {
      await prisma.$disconnect();
    } catch (error) {
      // Ignore disconnect errors during cleanup
    }
  });

  describe('handleReveal', () => {
    test('should successfully handle a valid reveal request', async () => {
      // Create mock request with required parameters
      const req = mockRequest();
      const mockFundingTxHash = ethers.utils.hexlify(ethers.utils.randomBytes(32));
      const mockFundingOutputIndex = 0;

      req.body = {
        fundingTxHash: mockFundingTxHash,
        fundingTx: {
          value: ethers.utils.parseEther('0.1').toString(),
          version: '0x01000000',
          inputVector:
            '0x010000000000000000000000000000000000000000000000000000000000000000ffffffff0000ffffffff',
          outputVector: '0x0100000000000000001976a914000000000000000000000000000000000000000088ac',
          locktime: '0x00000000',
        },
        reveal: {
          fundingOutputIndex: mockFundingOutputIndex,
          blindingFactor: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
          walletPubKeyHash: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
          refundPubKeyHash: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
          refundLocktime: ethers.utils.hexlify(ethers.utils.randomBytes(4)),
          vault: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
        },
        l2DepositOwner: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
        l2Sender: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
      };

      // Create mock response
      const res = mockResponse();

      // Call handleReveal
      await endpointController.handleReveal(req, res);

      // Verify DepositStore operations were called
      expect(mockDepositStore.getById).toHaveBeenCalledWith(expect.any(String));
      expect(mockDepositStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          status: DepositStatus.QUEUED,
        }),
      );

      // Verify response
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          depositId: expect.any(String),
          message: 'Deposit initialized successfully',
        }),
      );
    });

    test('should return 400 for missing required fields', async () => {
      // Create mock request with missing fields
      const req = mockRequest();
      req.body = {
        // Missing fields
        fundingTx: {
          value: ethers.utils.parseEther('0.1').toString(),
          version: '0x01000000',
          inputVector:
            '0x010000000000000000000000000000000000000000000000000000000000000000ffffffff0000ffffffff',
          outputVector: '0x0100000000000000001976a914000000000000000000000000000000000000000088ac',
          locktime: '0x00000000',
        },
        // Missing reveal, l2DepositOwner, l2Sender
      };

      // Create mock response
      const res = mockResponse();

      // Call handleReveal
      await endpointController.handleReveal(req, res);

      // Verify response
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Missing required fields in request body',
        }),
      );
    });

    test('should return 409 when deposit already exists', async () => {
      // Mock existing deposit
      const existingDeposit = createTestDeposit({ status: DepositStatus.QUEUED });
      mockDepositStore.getById.mockResolvedValue(existingDeposit);

      // Create mock request with valid data
      const req = mockRequest();
      req.body = {
        fundingTx: {
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

      const res = mockResponse();

      // Call handleReveal
      await endpointController.handleReveal(req, res);

      // Verify response
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Deposit already exists',
          depositId: expect.any(String),
        }),
      );

      // Verify deposit creation was not attempted
      expect(mockDepositStore.create).not.toHaveBeenCalled();
    });

    test('should return 500 when deposit creation fails', async () => {
      // Mock deposit creation failure
      mockDepositStore.create.mockRejectedValue(new Error('Database connection failed'));

      // Create mock request with valid data
      const req = mockRequest();
      req.body = {
        fundingTx: {
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

      const res = mockResponse();

      // Call handleReveal
      await endpointController.handleReveal(req, res);

      // Verify response
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Failed to save deposit to database',
          depositId: expect.any(String),
        }),
      );

      // Verify initializeDeposit was not called
      const initializeDepositSpy = jest.spyOn(mockChainHandler, 'initializeDeposit');
      expect(initializeDepositSpy).not.toHaveBeenCalled();
    });

    test('should return 500 when deposit initialization fails', async () => {
      // Mock initializeDeposit to return undefined (failure)
      const initializeDepositSpy = jest
        .spyOn(mockChainHandler, 'initializeDeposit')
        .mockResolvedValue(undefined);

      // Create mock request with valid data
      const req = mockRequest();
      req.body = {
        fundingTx: {
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

      const res = mockResponse();

      // Call handleReveal
      await endpointController.handleReveal(req, res);

      // Verify deposit was created but initialization failed
      expect(mockDepositStore.create).toHaveBeenCalled();
      expect(initializeDepositSpy).toHaveBeenCalled();

      // Verify response
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Deposit initialization failed',
          depositId: expect.any(String),
          message: 'Deposit was saved but initialization on L1 failed',
        }),
      );
    });
  });

  describe('getDepositStatus', () => {
    test('should return status for a valid deposit ID', async () => {
      // Create test deposit and add it to the chain handler
      const testDeposit = createTestDeposit({
        status: DepositStatus.INITIALIZED,
      });
      mockChainHandler.addDeposit(testDeposit);

      // Create mock request with deposit ID
      const req = mockRequest();
      req.params = {
        depositId: testDeposit.id,
      };

      // Create mock response
      const res = mockResponse();

      // Call getDepositStatus
      await endpointController.getDepositStatus(req, res);

      // Verify response
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          depositId: testDeposit.id,
          status: DepositStatus.INITIALIZED,
        }),
      );
    });

    test('should return 400 for missing deposit ID', async () => {
      // Create mock request with missing deposit ID
      const req = mockRequest();
      req.params = {
        // Missing depositId
      };

      // Create mock response
      const res = mockResponse();

      // Call getDepositStatus
      await endpointController.getDepositStatus(req, res);

      // Verify response
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Missing depositId parameter',
        }),
      );
    });
  });
});
