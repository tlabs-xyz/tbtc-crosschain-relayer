import { Request, Response } from 'express';
import { EndpointController } from '../../../controllers/Endpoint.controller';
import { MockChainHandler } from '../../mocks/MockChainHandler';
import { createTestDeposit } from '../../mocks/BlockchainMock';
import { ethers } from 'ethers';
import { DepositStatus } from '../../../types/DepositStatus.enum';

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

  beforeEach(() => {
    // Create a new MockChainHandler for each test
    mockChainHandler = new MockChainHandler();

    // Create a new EndpointController with the MockChainHandler
    endpointController = new EndpointController(mockChainHandler);
  });

  describe('handleReveal', () => {
    test('should successfully handle a valid reveal request', async () => {
      // Create mock request with required parameters
      const req = mockRequest();
      req.body = {
        fundingTx: {
          outputIndex: 0,
          value: ethers.utils.parseEther('0.1').toString(),
          version: '0x01000000',
          inputVector:
            '0x010000000000000000000000000000000000000000000000000000000000000000ffffffff0000ffffffff',
          outputVector:
            '0x0100000000000000001976a914000000000000000000000000000000000000000088ac',
          locktime: '0x00000000',
        },
        reveal: [
          0,
          ethers.utils.hexlify(ethers.utils.randomBytes(32)),
          ethers.utils.hexlify(ethers.utils.randomBytes(20)),
          ethers.utils.hexlify(ethers.utils.randomBytes(20)),
          ethers.utils.hexlify(ethers.utils.randomBytes(4)),
          '0x',
        ],
        l2DepositOwner: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
        l2Sender: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
      };

      // Create mock response
      const res = mockResponse();

      // Call handleReveal
      await endpointController.handleReveal(req, res);

      // Verify response
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          depositId: expect.any(String),
          message: 'Deposit initialized successfully',
        })
      );
    });

    test('should return 400 for missing required fields', async () => {
      // Create mock request with missing fields
      const req = mockRequest();
      req.body = {
        // Missing fields
        fundingTx: {
          outputIndex: 0,
          value: ethers.utils.parseEther('0.1').toString(),
          version: '0x01000000',
          inputVector:
            '0x010000000000000000000000000000000000000000000000000000000000000000ffffffff0000ffffffff',
          outputVector:
            '0x0100000000000000001976a914000000000000000000000000000000000000000088ac',
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
        })
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
        })
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
        })
      );
    });
  });
});
