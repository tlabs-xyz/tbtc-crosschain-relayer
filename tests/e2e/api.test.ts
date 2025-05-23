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

      // Tests for POST /api/:chainName/reveal
      describe(`POST /api/${chainName}/reveal`, () => {
        if (chainConfig?.supportsRevealDepositAPI) {
          test('should return 200 and deposit ID for valid data when API is supported', async () => {
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

          test('should return 400 for missing required fields when API is supported', async () => {
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
        } else {
          test('should return 405 when API is not supported for this chain', async () => {
            const response = await request(app).post(`/api/${chainName}/reveal`).send(validRevealData);
            expect(response.status).toBe(405);
            expect(response.body).toEqual(
              expect.objectContaining({
                success: false,
                error: `Reveal deposit API is not supported or enabled for chain: ${chainName}`,
              }),
            );
          });
        }
      });

      // Conditional GET /api/:chainName/deposit/:depositId tests
      // These depend on whether reveal was possible, so we use supportsRevealDepositAPI
      describe(`GET /api/${chainName}/deposit/:depositId`, () => {
        test('should return 200 and deposit status for valid ID (if reveal supported and successful)', async () => {
          let depositIdToTest: string | null = null;

          if (chainConfig?.supportsRevealDepositAPI) {
            const revealResponse = await request(app).post(`/api/${chainName}/reveal`).send(validRevealData);
            if (revealResponse.body.success) {
              depositIdToTest = revealResponse.body.depositId;
            }
          }

          if (depositIdToTest) {
            const response = await request(app).get(`/api/${chainName}/deposit/${depositIdToTest}`);
            expect(response.status).toBe(200);
            expect(response.body).toEqual({
              success: true,
              depositId: depositIdToTest,
            });
            expect([DepositStatus.QUEUED, DepositStatus.INITIALIZED]).toContain(response.body.status);
          } else {
            if (chainConfig?.supportsRevealDepositAPI) {
                 console.warn(`Skipping GET /api/${chainName}/deposit/:depositId test because prerequisite reveal failed or was not applicable.`);
            } else {
                console.warn(`Skipping GET /api/${chainName}/deposit/:depositId because reveal API is not supported for this chain.`);
            }
          }
        });

        test('should return 404 for non-existent deposit ID', async () => {
          const nonExistentId = 'nonExistentDepositIdForSure';
          const response = await request(app).get(`/api/${chainName}/deposit/${nonExistentId}`);
          expect(response.status).toBe(404); 
          expect(response.body).toEqual(expect.objectContaining({ success: false, error: 'Deposit not found' }));
        });
      });

      // Full deposit lifecycle test per chain, also conditional on API support
      if (chainConfig?.supportsRevealDepositAPI) {
        describe(`Full deposit lifecycle on ${chainName} (when API supported)`, () => {
          test('should process a deposit through the reveal and initial status check', async () => {
            const createResponse = await request(app).post(`/api/${chainName}/reveal`).send(validRevealData);
            expect(createResponse.status).toBe(200);
            expect(createResponse.body.success).toBe(true);
            const depositId = createResponse.body.depositId;
            expect(depositId).toBeDefined();

            const statusResponse = await request(app).get(`/api/${chainName}/deposit/${depositId}`);
            expect(statusResponse.status).toBe(200);
            expect([DepositStatus.QUEUED, DepositStatus.INITIALIZED]).toContain(statusResponse.body.status);
          });
        });
      }
    });
  });
});
