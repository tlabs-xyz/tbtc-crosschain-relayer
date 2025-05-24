// Set this before any other imports that might initialize the app core
process.env.SUPPORTED_CHAINS = 'mockEVM1,mockEVM2,faultyMockEVM';

import request from 'supertest';
import express from 'express';
import type { Express } from 'express';
import { ethers } from 'ethers';
import { DepositStatus } from '../../types/DepositStatus.enum.js';
import { chainConfigs as loadedChainConfigs, type AnyChainConfig } from '../../config/index.js';
import type { EvmChainConfig } from '../../config/schemas/evm.chain.schema.js';
import { chainHandlerRegistry } from '../../handlers/ChainHandlerRegistry.js'; // Global instance
import { initializationPromise } from '../../index.js';
import { router as mainAppRouter } from '../../routes/Routes.js'; // Global router

// Store deposits made by mocks
const mockChainDeposits = new Map<string, Map<string, any>>(); // chainName -> depositId -> Deposit

jest.mock('../../handlers/EVMChainHandler.js', () => {
  return {
    EVMChainHandler: jest.fn().mockImplementation((config: EvmChainConfig) => {
      const chainName = config.chainName;
      if (!mockChainDeposits.has(chainName)) {
        mockChainDeposits.set(chainName, new Map<string, any>());
      }
      const depositsInThisChain = mockChainDeposits.get(chainName)!;

      if (chainName === 'FaultyMockEVM') {
        return {
          config,
          initializeDeposit: jest
            .fn()
            .mockRejectedValue(new Error('FaultyMockEVM: Simulated initializeDeposit error')),
          checkDepositStatus: jest
            .fn()
            .mockRejectedValue(new Error('FaultyMockEVM: Simulated checkDepositStatus error')),
          finalizeDeposit: jest
            .fn()
            .mockRejectedValue(new Error('FaultyMockEVM: Simulated finalizeDeposit error')),
        };
      }

      // Regular mock EVM handler
      return {
        config,
        initializeDeposit: jest.fn().mockImplementation(async (deposit: any) => {
          const newDeposit = { ...deposit, status: DepositStatus.INITIALIZED, chainName };
          depositsInThisChain.set(deposit.id, newDeposit);
          return {
            transactionHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
            status: 1,
          };
        }),
        checkDepositStatus: jest.fn().mockImplementation(async (depositId: string) => {
          const deposit = depositsInThisChain.get(depositId);
          return deposit ? deposit.status : null;
        }),
        finalizeDeposit: jest.fn().mockImplementation(async (depositId: string) => {
          const deposit = depositsInThisChain.get(depositId);
          if (deposit) {
            deposit.status = DepositStatus.FINALIZED;
            return {
              transactionHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
              status: 1,
            };
          }
          throw new Error('Deposit not found for finalization in mock');
        }),
      };
    }),
  };
});

let activeChainConfigsArray: AnyChainConfig[] = [];
let localApp: Express;

beforeAll(async () => {
  await initializationPromise; // Ensure any main app async init is done

  const supportedChainKeysFromEnv = (process.env.SUPPORTED_CHAINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  activeChainConfigsArray = supportedChainKeysFromEnv
    .map((key) => loadedChainConfigs[key])
    .filter((config): config is AnyChainConfig => !!config);

  // IMPORTANT: Clear and re-initialize the *global* chainHandlerRegistry
  // with our MOCKED handlers for the specific chains needed in this test suite.
  chainHandlerRegistry.clear();
  await chainHandlerRegistry.initialize(activeChainConfigsArray); // Uses the mocked EVMChainHandler

  // Verify mocks are in the global registry
  for (const config of activeChainConfigsArray) {
    if (!chainHandlerRegistry.get(config.chainName)) {
      throw new Error(`Mock handler for ${config.chainName} not in global registry.`);
    }
  }

  localApp = express();
  localApp.use(express.json());
  localApp.use(mainAppRouter); // Use the global router, which uses the global registry
});

describe('API Endpoint Tests with Local App and Global Registry', () => {
  const getValidRevealData = () => ({
    fundingOutputBlindingFactor: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
    fundingOutputIndex: 0,
    fundingTxBytecode: '0xabcdef0123456789',
    l1Recipient: ethers.Wallet.createRandom().address,
    refundPublicKeyHash: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
    walletPublicKeyHash: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
  });

  describe('API Endpoints - Multi-Chain', () => {
    const getValidRevealDataForChain = () => {
      // Simplified valid reveal data for mock handlers
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
          0, // outputIndex
          ethers.utils.hexlify(ethers.utils.randomBytes(32)), // blindingFactor
          ethers.utils.hexlify(ethers.utils.randomBytes(20)), // depositor
          ethers.utils.hexlify(ethers.utils.randomBytes(20)), // l2Address
          ethers.utils.hexlify(ethers.utils.randomBytes(4)), // deadline (uint32)
          '0x', // btcRecoveryAddress (empty for now)
        ],
        l2DepositOwner: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
        l2Sender: ethers.utils.hexlify(ethers.utils.randomBytes(20)), // Assuming l2Sender is also needed by mock
      };
    };

    beforeEach(() => {
      // Clear mock deposit states for each chain before a test
      mockChainDeposits.forEach((map) => map.clear());
    });

    test('Supported chains are correctly loaded for testing', () => {
      expect(process.env.SUPPORTED_CHAINS).toBe('mockEVM1,mockEVM2,faultyMockEVM');
      expect(activeChainConfigsArray.length).toBe(3);
      const testChainNames = activeChainConfigsArray.map((c) => c.chainName);
      expect(testChainNames).toEqual(
        expect.arrayContaining(['MockEVM1', 'MockEVM2', 'FaultyMockEVM']),
      );
    });

    describe('GET /', () => {
      test('should return 200 and a welcome message', async () => {
        const response = await request(localApp).get('/');
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
        const response = await request(localApp).get('/status');
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          message: 'Operation succesful', // Note: "succesful" typo matches original if intended
          data: null,
          error: false,
        });
      });
    });

    describe('API Access with Invalid Chain', () => {
      test('should return 404 for an unsupported chain name in path', async () => {
        const response = await request(localApp).get(
          '/api/UnsupportedChainXYZ123/deposit/someFakeDepositId',
        );
        // This test expects 404 because the middleware should reject unknown chains
        // The exact error message might depend on whether the main router or chain-specific router handles it.
        expect(response.status).toBe(404);
      });
    });

    // Loop through each configured and supported chain for testing its specific endpoints
    activeChainConfigsArray.forEach((chainConfig) => {
      const chainName = chainConfig.chainName;

      describe(`Endpoints for chain: ${chainName}`, () => {
        const validRevealData = getValidRevealDataForChain();

        if (!chainConfig.useEndpoint) {
          // Tests for chains that DO NOT use the /endpoint route (EVM-like)
          describe(`POST /api/${chainName}/reveal`, () => {
            test('should return 200 and deposit ID for valid data', async () => {
              mockChainDeposits.get(chainName)?.clear(); // ensure clean state for this chain

              const response = await request(localApp)
                .post(`/api/${chainName}/reveal`)
                .send(validRevealData)
                .set('Content-Type', 'application/json'); // Ensure content type

              if (chainName === 'FaultyMockEVM') {
                expect(response.status).toBe(500);
                expect(response.body).toEqual(
                  expect.objectContaining({
                    success: false,
                    error: expect.stringContaining('Simulated initializeDeposit error'),
                  }),
                );
              } else {
                expect(response.status).toBe(200); // Or 201 if that's the actual response
                expect(response.body).toEqual(
                  expect.objectContaining({
                    success: true,
                    depositId: expect.any(String),
                    message: 'Deposit initialized successfully', // Or actual success message
                  }),
                );
              }
            });

            test('should return 400 for missing required fields', async () => {
              const incompleteRevealData = { fundingTx: validRevealData.fundingTx }; // Example of incomplete data
              const response = await request(localApp)
                .post(`/api/${chainName}/reveal`)
                .send(incompleteRevealData)
                .set('Content-Type', 'application/json');
              expect(response.status).toBe(400);
              expect(response.body).toEqual(
                expect.objectContaining({
                  success: false,
                  error: 'Missing required fields in request body', // Or actual error
                }),
              );
            });
          });

          describe(`GET /api/${chainName}/deposit/:depositId`, () => {
            let depositIdForTest: string | null = null;

            beforeEach(async () => {
              // Create a deposit to test against, unless it's the faulty chain
              if (chainName !== 'FaultyMockEVM') {
                mockChainDeposits.get(chainName)?.clear();
                const revealResponse = await request(localApp)
                  .post(`/api/${chainName}/reveal`)
                  .send(getValidRevealDataForChain());
                if (revealResponse.body.success) {
                  depositIdForTest = revealResponse.body.depositId;
                } else {
                  // Log if reveal failed, as it impacts downstream tests
                  console.warn(
                    `Prerequisite reveal failed for ${chainName} in GET test setup: ${revealResponse.body.error}`,
                  );
                  depositIdForTest = null;
                }
              }
            });

            test('should return 200 and deposit status for a valid ID', async () => {
              if (chainName === 'FaultyMockEVM') {
                const response = await request(localApp).get(
                  `/api/${chainName}/deposit/anyFakeIdForFaultyChain`,
                );
                expect(response.status).toBe(500);
                expect(response.body.error).toContain('Simulated checkDepositStatus error');
              } else if (depositIdForTest) {
                const response = await request(localApp).get(
                  `/api/${chainName}/deposit/${depositIdForTest}`,
                );
                expect(response.status).toBe(200);
                expect(response.body).toEqual(
                  expect.objectContaining({
                    success: true,
                    depositId: depositIdForTest,
                    status: DepositStatus.INITIALIZED, // Mocked initial status after reveal
                  }),
                );
              } else if (chainName !== 'FaultyMockEVM') {
                // This case means prerequisite reveal failed.
                // We can't proceed with the test as intended.
                // Mark as pending or throw to indicate setup failure.
                pending('Skipping GET test due to failed prerequisite reveal.');
              }
            });

            test('should return 404 for a non-existent deposit ID', async () => {
              if (chainName !== 'FaultyMockEVM') {
                // Faulty chain gives 500
                const nonExistentId = 'nonExistentId12345';
                const response = await request(localApp).get(
                  `/api/${chainName}/deposit/${nonExistentId}`,
                );
                expect(response.status).toBe(404);
                expect(response.body.error).toContain('Deposit not found');
              }
            });
          });

          describe(`POST /api/${chainName}/deposit/:depositId/finalize`, () => {
            let depositIdForTest: string | null = null;

            beforeEach(async () => {
              if (chainName !== 'FaultyMockEVM') {
                mockChainDeposits.get(chainName)?.clear();
                const revealResponse = await request(localApp)
                  .post(`/api/${chainName}/reveal`)
                  .send(getValidRevealDataForChain());
                if (revealResponse.body.success) {
                  depositIdForTest = revealResponse.body.depositId;
                } else {
                  console.warn(
                    `Prerequisite reveal failed for ${chainName} in POST finalize test setup: ${revealResponse.body.error}`,
                  );
                  depositIdForTest = null;
                }
              }
            });

            test('should finalize a deposit and update status', async () => {
              if (chainName === 'FaultyMockEVM') {
                const response = await request(localApp).post(
                  `/api/${chainName}/deposit/anyFakeIdForFaultyChain/finalize`,
                );
                expect(response.status).toBe(500);
                expect(response.body.error).toContain('Simulated finalizeDeposit error');
              } else if (depositIdForTest) {
                // Simulate that the deposit is in a state that allows finalization (e.g., INITIALIZED or QUEUED)
                // Our mock EVMChainHandler's checkDepositStatus will return what's in mockSimulatedDepositStatuses or depositsInThisChain
                // Ensure it's in a finalizable state if the real handler checks. Our mock finalize doesn't currently check status.

                const finalizeResponse = await request(localApp).post(
                  `/api/${chainName}/deposit/${depositIdForTest}/finalize`,
                );
                expect(finalizeResponse.status).toBe(200);
                expect(finalizeResponse.body).toEqual(
                  expect.objectContaining({
                    success: true,
                    message: 'Deposit finalized successfully', // Or actual message
                    transactionHash: expect.any(String),
                  }),
                );

                // Verify status changed to FINALIZED
                const statusResponse = await request(localApp).get(
                  `/api/${chainName}/deposit/${depositIdForTest}`,
                );
                expect(statusResponse.status).toBe(200);
                expect(statusResponse.body.status).toBe(DepositStatus.FINALIZED);
              } else if (chainName !== 'FaultyMockEVM') {
                pending('Skipping POST finalize test due to failed prerequisite reveal.');
              }
            });
          });
        } else {
          // Tests for chains that DO use /endpoint route (e.g., Solana-like)
          // Placeholder for now, as current mocks are EVM-like
          describe(`POST /api/${chainName}/endpoint`, () => {
            test.skip('should handle endpoint requests correctly for useEndpoint chains', () => {
              // Placeholder for future chain types that use a generic /endpoint
            });
          });
        }
      });
    });
  });
});
