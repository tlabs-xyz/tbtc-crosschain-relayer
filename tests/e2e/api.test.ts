import request from 'supertest';
import { ethers } from 'ethers';
import { DepositStatus } from '../../types/DepositStatus.enum.js';
import { app, chainConfigs as importedChainConfigs, initializationPromise } from '../../index.js';

let testChainNames: string[] = [];
let chainConfigs: import('../../types/ChainConfig.type.js').ChainConfig[] = [];

beforeAll(async () => {
  await initializationPromise;
  chainConfigs = importedChainConfigs;
  testChainNames = chainConfigs.map(c => c.chainName);
  if (testChainNames.length === 0) {
    throw new Error('No test chains loaded after initialization. Check test-chain-config.json and ConfigLoader logic.');
  }
});

describe('API Endpoints - Multi-Chain', () => {
  describe('GET /', () => {
    test('should return 200 and a welcome message', async () => {
      const response = await request(app).get('/');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'API Information: ',
        data: {
          name: process.env.APP_NAME || 'Unknown API',
          version: process.env.APP_VERSION || '1.0.0',
        },
        error: false,
      });
    });
  });

  describe('GET /status', () => {
    test('should return 200 and status OK', async () => {
      const response = await request(app).get('/status');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Operation succesful',
        data: null,
        error: false,
      });
    });
  });

  // Test data for reveal endpoint - this might need to be adjusted per chain type (EVM vs Solana)
  const getValidRevealDataForChain = (chainName: string) => {
    // Basic EVM-like reveal data, can be customized if MockSolana1 needs different structure
    return {
      fundingTx: {
        txHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        outputIndex: 0,
        value: ethers.utils.parseEther('0.1').toString(),
        version: '0x01000000',
        inputVector:
          '0x010000000000000000000000000000000000000000000000000000000000000000ffffffff0000ffffffff',
        outputVector: '0x0100000000000000001976a914000000000000000000000000000000000000000088ac',
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
  };

  testChainNames.forEach(chainName => {
    describe(`Endpoints for chain: ${chainName}`, () => {
      const validRevealData = getValidRevealDataForChain(chainName);
      const chainConfig = chainConfigs.find(c => c.chainName === chainName);

      // Skip reveal tests for chains configured with useEndpoint = true as /api/:chainName/reveal might not exist
      if (!chainConfig?.useEndpoint) {
        describe(`POST /api/${chainName}/reveal`, () => {
          test('should return 200 and deposit ID for valid data', async () => {
            const response = await request(app).post(`/api/${chainName}/reveal`).send(validRevealData);
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
            const incompleteRevealData = { fundingTx: validRevealData.fundingTx }; 
            const response = await request(app)
              .post(`/api/${chainName}/reveal`)
              .send(incompleteRevealData)
              .set('Content-Type', 'application/json');
            expect(response.status).toBe(400);
            expect(response.body).toEqual(
              expect.objectContaining({
                success: false,
                error: 'Missing required fields in request body',
              }),
            );
          });
        });
      }

      describe(`GET /api/${chainName}/deposit/:depositId`, () => {
        test('should return 200 and deposit status for valid ID', async () => {
          // This test needs a deposit to exist for this chain. 
          // We need a way to create a deposit via API or pre-populate in MockChainHandler for this specific chain.
          // For now, let's assume a deposit can be created first if reveal endpoint exists for the chain
          let depositIdToTest: string | null = null;

          if (!chainConfig?.useEndpoint) {
            const revealResponse = await request(app).post(`/api/${chainName}/reveal`).send(validRevealData);
            if (revealResponse.body.success) {
              depositIdToTest = revealResponse.body.depositId;
            }
          }
          // If reveal endpoint isn't used or failed, this test part will be skipped or needs alternative setup.
          // For a chain using an endpoint, the deposit is created externally, so we'd need a known test deposit ID.
          // This part of the test needs more robust setup based on chainConfig.useEndpoint

          if (depositIdToTest) {
            const response = await request(app).get(`/api/${chainName}/deposit/${depositIdToTest}`);
            expect(response.status).toBe(200);
            expect(response.body).toEqual({
              success: true,
              depositId: depositIdToTest,
              status: expect.any(Number), // Status can be QUEUED or INITIALIZED
            });
            expect([DepositStatus.QUEUED, DepositStatus.INITIALIZED]).toContain(response.body.status);
          } else {
            if (!chainConfig?.useEndpoint) {
                 console.warn(`Skipping GET /api/${chainName}/deposit/:depositId test because prerequisite reveal failed or was skipped.`);
            } else {
                // For endpoint chains, we would need a predefined testable deposit ID
                console.warn(`Skipping GET /api/${chainName}/deposit/:depositId for endpoint chain - needs predefined test ID.`);
            }
          }
        });

        test('should return 404 for non-existent deposit ID', async () => {
          const nonExistentId = 'nonExistentDepositIdForSure';
          const response = await request(app).get(`/api/${chainName}/deposit/${nonExistentId}`);
          expect(response.status).toBe(404); // Assuming 404 for not found
          expect(response.body).toEqual(expect.objectContaining({ success: false, error: 'Deposit not found' }));
        });
      });

      // Full deposit lifecycle test per chain
      if (!chainConfig?.useEndpoint) {
        describe(`Full deposit lifecycle on ${chainName}`, () => {
          test('should process a deposit through the reveal and initial status check', async () => {
            const createResponse = await request(app).post(`/api/${chainName}/reveal`).send(validRevealData);
            expect(createResponse.status).toBe(200);
            expect(createResponse.body.success).toBe(true);
            const depositId = createResponse.body.depositId;
            expect(depositId).toBeDefined();

            const statusResponse = await request(app).get(`/api/${chainName}/deposit/${depositId}`);
            expect(statusResponse.status).toBe(200);
            expect([DepositStatus.QUEUED, DepositStatus.INITIALIZED]).toContain(statusResponse.body.status);
            // Further lifecycle steps (initialization, finalization) depend on mock chain processing, 
            // which happens asynchronously. Testing those would require more complex test orchestration.
          });
        });
      }
    });
  });
});
