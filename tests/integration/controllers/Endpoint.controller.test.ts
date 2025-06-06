// tests/integration/controllers/Endpoint.controller.test.ts - Integration tests for EndpointController
//
// This suite tests the EndpointController's reveal and status endpoints using a mock chain handler.
// It covers valid/invalid requests, deposit status, and error handling.

import type { Request, Response } from 'express';
import { MockChainHandler } from '../../mocks/MockChainHandler.js';
import { createTestDeposit } from '../../mocks/BlockchainMock.js';
import * as AllEthers from 'ethers';
import { DepositStatus } from '../../../types/DepositStatus.enum.js';
import { EndpointController } from '../../../controllers/Endpoint.controller.js';

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
      const mockFundingTxHash = AllEthers.utils.hexlify(AllEthers.utils.randomBytes(32));
      const mockFundingOutputIndex = 0;

      req.body = {
        fundingTxHash: mockFundingTxHash,
        fundingTx: {
          txHash: mockFundingTxHash,
          value: AllEthers.utils.parseEther('0.1').toString(),
          version: '0x01000000',
          inputVector:
            '0x010000000000000000000000000000000000000000000000000000000000000000ffffffff0000ffffffff',
          outputVector: '0x0100000000000000001976a914000000000000000000000000000000000000000088ac',
          locktime: '0x00000000',
        },
        reveal: {
          fundingOutputIndex: mockFundingOutputIndex,
          blindingFactor: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(32)),
          walletPubKeyHash: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
          refundPubKeyHash: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
          refundLocktime: '1700000000',
          vault: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
        },
        l2DepositOwner: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
        l2Sender: AllEthers.utils.hexlify(AllEthers.utils.randomBytes(20)),
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
        }),
      );
    });

    test('should return 400 for missing required fields', async () => {
      // Create mock request with missing fields
      const req = mockRequest();
      req.body = {
        // fundingTxHash is missing
        // fundingTx is present but structure might not matter if top level fields are missing
        fundingTx: {
          value: AllEthers.utils.parseEther('0.1').toString(),
          version: '0x01000000',
          inputVector:
            '0x010000000000000000000000000000000000000000000000000000000000000000ffffffff0000ffffffff',
          outputVector: '0x0100000000000000001976a914000000000000000000000000000000000000000088ac',
          locktime: '0x00000000',
        },
        // reveal is missing
        // l2DepositOwner is missing
        // l2Sender is missing
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
          error: 'Invalid request body format.',
          details: expect.objectContaining({
            fieldErrors: expect.objectContaining({
              reveal: expect.arrayContaining([expect.stringMatching(/Required|Invalid input/i)]),
              l2DepositOwner: expect.arrayContaining([
                expect.stringMatching(/Required|Invalid input/i),
              ]),
              l2Sender: expect.arrayContaining([expect.stringMatching(/Required|Invalid input/i)]),
            }),
          }),
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
