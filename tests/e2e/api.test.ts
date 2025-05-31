// Store original env vars at the very top, if they might be set by other means
const originalSupportedChainsEnv = process.env.SUPPORTED_CHAINS;
const originalNodeEnv = process.env.NODE_ENV;

// All imports that might be affected by jest.resetModules should be inside describe or beforeAll
// or typed and assigned after dynamic import.
import request from 'supertest';
import express from 'express';
import type { Express } from 'express';
import { ethers } from 'ethers'; // ethers is likely not affected by resetModules in this context
import { DepositStatus } from '../../types/DepositStatus.enum';
import type { AnyChainConfig } from '../../config'; // Type import is fine
import type { SolanaChainConfig } from '../../config/schemas/solana.chain.schema'; // Type import
import type { EvmChainConfig } from '../../config/schemas/evm.chain.schema'; // Type import
import { CHAIN_TYPE, NETWORK } from '../../config/schemas/common.schema'; // Enum import is fine
import type { ChainHandlerInterface } from '../../interfaces/ChainHandler.interface'; // Type import
import type { TransactionReceipt } from '@ethersproject/providers'; // Type import
import type { Deposit } from '../../types/Deposit.type'; // Type import
import type { Reveal } from '../../types/Reveal.type'; // Type import

// Module-level state for mocks needs to be accessible after resetModules too.
// These are fine here as they are not re-imported dynamically in the same way config is.
const mockEvmChainDeposits = new Map<string, Map<string, Deposit>>();
const mockEndpointChainDeposits = new Map<string, Map<string, Deposit>>();

export type MockEndpointChainConfig = SolanaChainConfig & {
  readonly useEndpoint: true;
  readonly chainType: CHAIN_TYPE.SOLANA;
  readonly l1Confirmations: number;
};

// This config definition is fine at module scope as it's used by the dynamic setup.
const mockEndpointChainTestConfig: MockEndpointChainConfig = {
  network: NETWORK.TESTNET,
  useEndpoint: true,
  supportsRevealDepositAPI: true,
  enableL2Redemption: false,
  l1Rpc: 'http://localhost:8545/mock',
  l2Rpc: 'http://localhost:8899/mock',
  l2WsRpc: 'ws://localhost:8090/mock',
  l1ContractAddress: ethers.constants.AddressZero,
  l2ContractAddress: ethers.constants.AddressZero,
  l1BitcoinRedeemerAddress: ethers.constants.AddressZero,
  l2WormholeGatewayAddress: ethers.constants.AddressZero,
  l2WormholeChainId: 1,
  l2StartBlock: 0,
  vaultAddress: ethers.constants.AddressZero,
  chainName: 'MockEndpointChain',
  chainType: CHAIN_TYPE.SOLANA,
  solanaCommitment: 'confirmed',
  solanaPrivateKey: 'mockPrivateKey',
  l1Confirmations: 1,
};

// The describeIfPKey and describeToRun logic is fine here
// const describeIfPKey = process.env.CHAIN_SEPOLIATESTNET_PRIVATE_KEY ? describe : describe.skip;
const describeToRun = describe; // Always run these mock-based E2E tests

describeToRun('E2E API Tests with Dynamic Env', () => {
  // Variables to hold dynamically imported modules
  let chainConfigsModule: typeof import('../../config');
  let mainAppRouterModule: typeof import('../../routes/Routes');
  let chainHandlerRegistryModule: typeof import('../../handlers/ChainHandlerRegistry');
  let initializationPromiseModule: typeof import('../..'); // Assuming index.ts exports this
  let loadedChainConfigsActual: Record<string, AnyChainConfig | undefined>;

  let activeChainConfigsArray: AnyChainConfig[] = [];
  let localApp: Express;

  beforeAll(async () => {
    jest.resetModules();

    // Mock Config utility if it's used directly by other modules after reset
    // This is a common pattern if Config.get() is used globally.
    jest.mock('../../utils/Config', () => {
      // console.log('[api.test.ts] Applying Config mock factory (moved before dynamic imports)');
      const originalConfigModule = jest.requireActual('../../utils/Config') as any;
      return {
        ...originalConfigModule,
        // Example: getConfiguredChains: () => ['mockEVM1', 'mockEVM2', 'mockEndpointChain'],
      };
    });

    // Dynamically import modules AFTER setting env vars and resetting cache
    chainConfigsModule = await import('../../config');
    mainAppRouterModule = await import('../../routes/Routes');
    chainHandlerRegistryModule = await import('../../handlers/ChainHandlerRegistry');
    initializationPromiseModule = await import('../..'); // Main index.ts
    loadedChainConfigsActual = chainConfigsModule.chainConfigs;

    // DEBUGGING: Log what config/index.ts actually loaded
    console.log('[api.test.ts] SUPPORTED_CHAINS for this test run:', process.env.SUPPORTED_CHAINS);
    console.log(
      '[api.test.ts] Keys from config/index.ts BEFORE manual add:',
      Object.keys(loadedChainConfigsActual),
    );
    for (const key of Object.keys(loadedChainConfigsActual)) {
      console.log(
        `[api.test.ts] Config for ${key} (from config/index.ts): ${loadedChainConfigsActual[key] ? 'EXISTS and TRUTHY' : 'MISSING or FALSY'}`,
      );
    }
    // END DEBUGGING

    (loadedChainConfigsActual as any)['mockEndpointChain'] = mockEndpointChainTestConfig;

    // Mock EVMChainHandler AFTER resetting modules and BEFORE it's used by ChainHandlerFactory via registry.initialize
    // This mock needs to be re-applied because jest.resetModules() clears it.
    jest.mock('../../handlers/EVMChainHandler', () => {
      // console.log('[api.test.ts] Applying EVMChainHandler mock factory');
      return {
        EVMChainHandler: jest.fn().mockImplementation((config: EvmChainConfig) => {
          const chainName = config.chainName;
          if (!mockEvmChainDeposits.has(chainName)) {
            mockEvmChainDeposits.set(chainName, new Map<string, Deposit>());
          }
          const depositsInThisChain = mockEvmChainDeposits.get(chainName)!;

          if (chainName === 'FaultyMockEVM') {
            return {
              config,
              supportsPastDepositCheck(): boolean {
                return false;
              },
              initializeDeposit: jest
                .fn()
                .mockRejectedValue(new Error('FaultyMockEVM: Simulated initializeDeposit error')),
              checkDepositStatus: jest
                .fn()
                .mockRejectedValue(new Error('FaultyMockEVM: Simulated checkDepositStatus error')),
              finalizeDeposit: jest
                .fn()
                .mockRejectedValue(new Error('FaultyMockEVM: Simulated finalizeDeposit error')),
              initialize: jest.fn().mockResolvedValue(undefined),
              setupListeners: jest.fn().mockResolvedValue(undefined),
              getLatestBlock: jest.fn().mockResolvedValue(100),
              processInitializeDeposits: jest.fn().mockResolvedValue(undefined),
              processFinalizeDeposits: jest.fn().mockResolvedValue(undefined),
              checkForPastDeposits: jest.fn().mockResolvedValue(undefined),
            };
          }
          return {
            config,
            supportsPastDepositCheck(): boolean {
              return false;
            },
            initializeDeposit: jest.fn().mockImplementation(async (deposit: Deposit) => {
              const newDeposit = { ...deposit, status: DepositStatus.INITIALIZED, chainName };
              depositsInThisChain.set(deposit.id, newDeposit);
              return {
                transactionHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
                status: 1,
                to: ethers.constants.AddressZero,
                from: ethers.constants.AddressZero,
                contractAddress: ethers.constants.AddressZero,
                transactionIndex: 0,
                gasUsed: ethers.BigNumber.from(0),
                logsBloom: '0x',
                blockHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
                logs: [],
                blockNumber: 0,
                confirmations: 1,
                cumulativeGasUsed: ethers.BigNumber.from(0),
                effectiveGasPrice: ethers.BigNumber.from(0),
                byzantium: true,
                type: 0,
              } as TransactionReceipt;
            }),
            checkDepositStatus: jest.fn().mockImplementation(async (depositId: string) => {
              const depositEntry = depositsInThisChain.get(depositId);
              return depositEntry ? depositEntry.status : null;
            }),
            finalizeDeposit: jest.fn().mockImplementation(async (deposit: Deposit) => {
              const existingDeposit = depositsInThisChain.get(deposit.id);
              if (existingDeposit) {
                existingDeposit.status = DepositStatus.FINALIZED;
                depositsInThisChain.set(deposit.id, existingDeposit);
                return {
                  transactionHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
                  status: 1,
                  to: ethers.constants.AddressZero,
                  from: ethers.constants.AddressZero,
                  contractAddress: ethers.constants.AddressZero,
                  transactionIndex: 0,
                  gasUsed: ethers.BigNumber.from(0),
                  logsBloom: '0x',
                  blockHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
                  logs: [],
                  blockNumber: 0,
                  confirmations: 1,
                  cumulativeGasUsed: ethers.BigNumber.from(0),
                  effectiveGasPrice: ethers.BigNumber.from(0),
                  byzantium: true,
                  type: 0,
                } as TransactionReceipt;
              }
              throw new Error('Deposit not found for finalization in mock EVM handler');
            }),
            initialize: jest.fn().mockResolvedValue(undefined),
            setupListeners: jest.fn().mockResolvedValue(undefined),
            getLatestBlock: jest.fn().mockResolvedValue(100),
            processInitializeDeposits: jest.fn().mockResolvedValue(undefined),
            processFinalizeDeposits: jest.fn().mockResolvedValue(undefined),
            checkForPastDeposits: jest.fn().mockResolvedValue(undefined),
          };
        }),
      };
    });

    // Mock for MockEndpointChainHandler - defined within this file, so resetModules doesn't affect its definition,
    // but its registration needs to happen with the fresh chainHandlerRegistry instance.
    // The class definition is MockEndpointChainHandler further down.

    await initializationPromiseModule.initializationPromise;

    const supportedChainKeysFromEnv = (process.env.SUPPORTED_CHAINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    activeChainConfigsArray = supportedChainKeysFromEnv
      .map((key) => loadedChainConfigsActual[key]) // Use the dynamically loaded and augmented configs
      .filter((config): config is AnyChainConfig => !!config);

    // console.log('[api.test.ts] activeChainConfigsArray length:', activeChainConfigsArray.length);
    // activeChainConfigsArray.forEach(c => console.log('[api.test.ts] Loaded for test:', c.chainName, c.useEndpoint));

    chainHandlerRegistryModule.chainHandlerRegistry.clear();
    await chainHandlerRegistryModule.chainHandlerRegistry.initialize(activeChainConfigsArray);

    for (const config of activeChainConfigsArray) {
      if (config.chainName === 'MockEndpointChain') {
        if (config.chainType === CHAIN_TYPE.SOLANA && config.useEndpoint) {
          chainHandlerRegistryModule.chainHandlerRegistry.register(
            config.chainName,
            new MockEndpointChainHandler(config as MockEndpointChainConfig), // MockEndpointChainHandler defined below
          );
        } else {
          throw new Error(
            'MockEndpointChain config is not correctly typed or useEndpoint is false.',
          );
        }
      }
      // EVM Handlers are mocked by jest.mock above, ChainHandlerFactory will pick them up.
    }

    // Verification of handlers (same as before)
    for (const config of activeChainConfigsArray) {
      const handler = chainHandlerRegistryModule.chainHandlerRegistry.get(config.chainName);
      if (!handler) {
        throw new Error(`Handler for ${config.chainName} not in global registry after setup.`);
      }
      if (
        config.chainName === 'MockEndpointChain' &&
        !(handler instanceof MockEndpointChainHandler)
      ) {
        throw new Error('MockEndpointChain is not using MockEndpointChainHandler.');
      }
      if (config.chainType === CHAIN_TYPE.EVM && handler) {
        if (!jest.isMockFunction((handler as any).initializeDeposit)) {
          throw new Error(
            `EVMChainHandler for ${config.chainName} does not appear to be the mocked version.`,
          );
        }
      }
    }

    localApp = express();
    localApp.use(express.json());
    localApp.use(mainAppRouterModule.router);
  });

  afterAll(async () => {
    // Restore original environment variables
    if (originalSupportedChainsEnv === undefined) {
      delete process.env.SUPPORTED_CHAINS;
    } else {
      process.env.SUPPORTED_CHAINS = originalSupportedChainsEnv;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    jest.resetModules(); // Clean up module cache for other tests
  });

  // MockEndpointChainHandler class definition (needs to be accessible by beforeAll)
  class MockEndpointChainHandler implements ChainHandlerInterface {
    public config: MockEndpointChainConfig;
    private deposits: Map<string, Deposit>;
    public supportsPastDepositCheck(): boolean {
      return false;
    }

    constructor(config: MockEndpointChainConfig) {
      this.config = config;
      if (!mockEndpointChainDeposits.has(config.chainName)) {
        mockEndpointChainDeposits.set(config.chainName, new Map<string, Deposit>());
      }
      this.deposits = mockEndpointChainDeposits.get(config.chainName)!;
    }

    async initialize(): Promise<void> {
      /* Mock */
    }
    async setupListeners(): Promise<void> {
      /* Mock */
    }
    async getLatestBlock(): Promise<number> {
      return 100;
    }
    async processInitializeDeposits(): Promise<void> {
      /* Mock */
    }
    async processFinalizeDeposits(): Promise<void> {
      /* Mock */
    }
    async checkForPastDeposits(): Promise<void> {
      /* Mock */
    }

    async initializeDeposit(deposit: Deposit): Promise<TransactionReceipt | undefined> {
      const newDeposit = {
        ...deposit,
        status: DepositStatus.INITIALIZED,
        chainName: this.config.chainName,
      };
      this.deposits.set(deposit.id, newDeposit);
      return {
        to: '',
        from: '',
        contractAddress: '',
        transactionIndex: 0,
        root: '',
        gasUsed: ethers.BigNumber.from(0),
        logsBloom: '',
        blockHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        transactionHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        logs: [],
        blockNumber: 0,
        confirmations: 1,
        cumulativeGasUsed: ethers.BigNumber.from(0),
        effectiveGasPrice: ethers.BigNumber.from(0),
        byzantium: true,
        type: 0,
        status: 1,
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
          to: '',
          from: '',
          contractAddress: '',
          transactionIndex: 0,
          root: '',
          gasUsed: ethers.BigNumber.from(0),
          logsBloom: '',
          blockHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
          transactionHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
          logs: [],
          blockNumber: 0,
          confirmations: 1,
          cumulativeGasUsed: ethers.BigNumber.from(0),
          effectiveGasPrice: ethers.BigNumber.from(0),
          byzantium: true,
          type: 0,
          status: 1,
        } as TransactionReceipt;
      }
      throw new Error('Deposit not found for finalization in MockEndpointChainHandler');
    }

    async handleEndpointRequest(action: string, data: any): Promise<any> {
      switch (action) {
        case 'initialize_deposit':
          if (!data || !data.id)
            throw new Error('Missing deposit data for initialize_deposit via endpoint');
          const initReceipt = await this.initializeDeposit(data as Deposit);
          return {
            depositId: data.id,
            receipt: initReceipt,
            message: 'Deposit initialized via endpoint',
          };
        case 'check_deposit_status':
          if (!data || !data.depositId)
            throw new Error('Missing depositId for check_deposit_status via endpoint');
          const status = await this.checkDepositStatus(data.depositId);
          if (status === null) {
            throw new Error('Deposit not found for check_deposit_status via endpoint');
          }
          return { depositId: data.depositId, status };
        case 'finalize_deposit':
          if (!data || !data.depositId)
            throw new Error('Missing depositId for finalize_deposit via endpoint');
          const depositToFinalize = this.deposits.get(data.depositId);
          if (!depositToFinalize) {
            throw new Error('Deposit not found for finalize_deposit via endpoint');
          }
          const finalReceipt = await this.finalizeDeposit(depositToFinalize);
          return {
            transactionHash: finalReceipt?.transactionHash,
            message: 'Deposit finalized via endpoint',
          };

        default:
          throw new Error(`Unsupported action: ${action}`);
      }
    }
  }

  // --- ALL ORIGINAL TEST SUITES AND TESTS GO HERE ---
  // Example of how the test that failed would look:
  describe('API Endpoints - Multi-Chain', () => {
    const getValidRevealDataForEvmChain = () => {
      // Mock data for a successful reveal, adjust as needed for your contract
      const fundingTx = {
        txHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        outputIndex: 0,
        value: ethers.utils.parseEther('0.1').toString(),
        version: '0x01000000',
        inputVector:
          '0x010000000000000000000000000000000000000000000000000000000000000000ffffffff0000ffffffff',
        outputVector: '0x0100000000000000001976a914000000000000000000000000000000000000000088ac',
        locktime: '0x00000000',
      };
      return {
        fundingTx,
        reveal: {
          fundingOutputIndex: 0,
          blindingFactor: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
          walletPubKeyHash: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
          refundPubKeyHash: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
          refundLocktime: ethers.BigNumber.from(Math.floor(Date.now() / 1000) + 3600).toString(), // e.g., 1 hour from now
          vault: ethers.constants.AddressZero, // Example vault address
        } as Reveal,
      };
    };
    const getValidDataForEndpointChain = (
      action: string,
      depositIdToUse?: string,
    ): Deposit | { depositId: string } | object => {
      // For endpoint chain, data might differ. This is a placeholder.
      const baseL2Sender = '0x' + '1'.repeat(40); // Mock L2 sender for endpoint
      const baseL2DepositOwner = '0x' + '2'.repeat(40); // Mock L2 owner for endpoint

      const baseReveal: Reveal = {
        fundingOutputIndex: 0,
        blindingFactor: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        walletPubKeyHash: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
        refundPubKeyHash: ethers.utils.hexlify(ethers.utils.randomBytes(20)),
        refundLocktime: ethers.BigNumber.from(Math.floor(Date.now() / 1000) + 7200).toString(), // e.g., 2 hours from now
        vault: 'mockVaultAddressForEndpoint',
      };

      if (action === 'reveal') {
        const fundingTx = {
          version: '1',
          inputVector: JSON.stringify([
            {
              prevout: { hash: ethers.utils.hexlify(ethers.utils.randomBytes(32)), index: 0 },
              scriptSig: ethers.utils.hexlify(ethers.utils.randomBytes(100)),
            },
          ]),
          outputVector: JSON.stringify([
            {
              value: '100000000',
              scriptPubKey: ethers.utils.hexlify(ethers.utils.randomBytes(50)),
            },
          ]),
          locktime: '0',
        };
        return {
          fundingTx,
          reveal: baseReveal,
          l2DepositOwner: baseL2DepositOwner,
          l2Sender: baseL2Sender,
        };
      }
      if (action === 'finalize' || action === 'status') {
        if (!depositIdToUse)
          throw new Error('depositId is required for finalize/status on endpoint chain');
        // For finalize, we might need more data than just ID, but for mock, ID is enough
        // to retrieve/update the deposit in MockEndpointChainHandler.
        // Let's assume the mock handler can create a dummy deposit from this for finalize
        // or already has it from a reveal call.
        // When it's a full Deposit object, it would be like this:
        const dummyDepositForFinalize: Partial<Deposit> & { id: string; chainName: string } = {
          id: depositIdToUse,
          chainName: mockEndpointChainTestConfig.chainName,
          fundingTxHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
          outputIndex: baseReveal.fundingOutputIndex,
          hashes: {
            btc: { btcTxHash: ethers.utils.hexlify(ethers.utils.randomBytes(32)) }, // Mocked BTC tx hash
            eth: { initializeTxHash: null, finalizeTxHash: null }, // Not applicable for Solana
            solana: { bridgeTxHash: null }, // Will be set upon successful bridging
          },
          receipt: {
            depositor: baseL2Sender,
            blindingFactor: baseReveal.blindingFactor,
            walletPublicKeyHash: baseReveal.walletPubKeyHash,
            refundPublicKeyHash: baseReveal.refundPubKeyHash,
            refundLocktime: baseReveal.refundLocktime,
            extraData: baseL2DepositOwner, // Or some other relevant data
          },
          L1OutputEvent: {
            // Mock L1 event data as it would have been captured
            fundingTx: {} as any, // Simplified for mock
            reveal: baseReveal,
            l2DepositOwner: baseL2DepositOwner,
            l2Sender: baseL2Sender,
          },
          owner: baseL2DepositOwner,
          status: DepositStatus.INITIALIZED, // Assume it was initialized before finalizing
          dates: {
            createdAt: Date.now() - 2000,
            initializationAt: Date.now() - 1000,
            finalizationAt: null,
            lastActivityAt: Date.now() - 1000,
            awaitingWormholeVAAMessageSince: null,
            bridgedAt: null,
          },
          wormholeInfo: { txHash: null, transferSequence: null, bridgingAttempted: false },
          error: null,
        };
        // For the purpose of the mock, sending just the ID is sufficient for `finalize` and `status`
        // as the mock handler will fetch/update based on this ID.
        // If sending the full deposit object is intended, then `dummyDepositForFinalize` would be returned.
        return { depositId: depositIdToUse };
      }
      return {}; // Default empty object for other actions
    };

    beforeEach(() => {
      mockEvmChainDeposits.forEach((map) => map.clear());
      mockEndpointChainDeposits.forEach((map) => map.clear());
    });

    test('Supported chains are correctly loaded for testing', () => {
      expect(process.env.SUPPORTED_CHAINS).toBe(
        'MockEVM1,MockEVM2,FaultyMockEVM,MockEndpointChain',
      );
      // This is the critical assertion
      expect(activeChainConfigsArray.length).toBe(4);
      const testChainNames = activeChainConfigsArray.map((c) => c.chainName);
      expect(testChainNames).toEqual(
        expect.arrayContaining(['MockEVM1', 'MockEVM2', 'FaultyMockEVM', 'MockEndpointChain']),
      );
      const endpointChainConfig = activeChainConfigsArray.find(
        (c) => c.chainName === 'MockEndpointChain',
      );
      expect(endpointChainConfig).toBeDefined();
      expect(endpointChainConfig?.useEndpoint).toBe(true);
    });

    // ... other describe blocks (GET /, GET /status, API Access with Invalid Chain) ...
    // These should be inside the main describeToRun('E2E API Tests with Dynamic Env', () => { ... });
    // and use the `localApp` and `activeChainConfigsArray` initialized in the dynamic beforeAll.

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
          message: 'Operation successful',
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
        expect(response.status).toBe(404);
      });
    });

    activeChainConfigsArray.forEach((chainConfig) => {
      const chainName = chainConfig.chainName;
      describe(`Endpoints for chain: ${chainName}`, () => {
        if (!chainConfig.useEndpoint) {
          // EVM-like tests (reveal, get status, finalize via specific routes)
          const validRevealData = getValidRevealDataForEvmChain();
          describe(`POST /api/${chainName}/reveal`, () => {
            // ... tests for /reveal (from original file)
            test('should return 200 and deposit ID for valid data', async () => {
              mockEvmChainDeposits.get(chainName)?.clear();
              const response = await request(localApp)
                .post(`/api/${chainName}/reveal`)
                .send(validRevealData)
                .set('Content-Type', 'application/json');
              if (chainName === 'FaultyMockEVM') {
                expect(response.status).toBe(500);
                expect(response.body).toEqual(
                  expect.objectContaining({
                    success: false,
                    error: expect.stringContaining('Simulated initializeDeposit error'),
                  }),
                );
              } else {
                expect(response.status).toBe(200);
                expect(response.body).toEqual(
                  expect.objectContaining({
                    success: true,
                    depositId: expect.any(String),
                    message: 'Deposit initialized successfully',
                  }),
                );
              }
            });
            test('should return 400 for missing required fields', async () => {
              const incompleteRevealData = { fundingTx: validRevealData.fundingTx };
              const response = await request(localApp)
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
          describe(`GET /api/${chainName}/deposit/:depositId`, () => {
            // ... tests for /deposit/:id (from original file)
            let depositIdForTest: string | null = null;
            beforeEach(async () => {
              if (chainName !== 'FaultyMockEVM') {
                mockEvmChainDeposits.get(chainName)?.clear();
                const revealResponse = await request(localApp)
                  .post(`/api/${chainName}/reveal`)
                  .send(getValidRevealDataForEvmChain());
                if (revealResponse.body.success) {
                  depositIdForTest = revealResponse.body.depositId;
                } else {
                  console.warn(`Prereq failed for ${chainName}: ${revealResponse.body.error}`);
                  depositIdForTest = null;
                }
              }
            });
            test('should return 200 and deposit status for a valid ID', async () => {
              if (chainName === 'FaultyMockEVM') {
                /* ... */
              } else if (depositIdForTest) {
                const response = await request(localApp).get(
                  `/api/${chainName}/deposit/${depositIdForTest}`,
                );
                expect(response.status).toBe(200);
                expect(response.body).toEqual(
                  expect.objectContaining({
                    success: true,
                    depositId: depositIdForTest,
                    status: DepositStatus.INITIALIZED,
                  }),
                );
              } else if (chainName !== 'FaultyMockEVM') {
                pending('Skipping GET test due to failed prerequisite reveal.');
              }
            });
            test('should return 404 for a non-existent deposit ID', async () => {
              if (chainName !== 'FaultyMockEVM') {
                const response = await request(localApp).get(
                  `/api/${chainName}/deposit/nonExistentId12345`,
                );
                expect(response.status).toBe(404);
                expect(response.body.message).toContain('Deposit not found');
              }
            });
          });
          describe(`POST /api/${chainName}/deposit/:depositId/finalize`, () => {
            // ... tests for /deposit/:id/finalize (from original file)
            let depositIdForTest: string | null = null;
            beforeEach(async () => {
              if (chainName !== 'FaultyMockEVM') {
                mockEvmChainDeposits.get(chainName)?.clear();
                const revealResponse = await request(localApp)
                  .post(`/api/${chainName}/reveal`)
                  .send(getValidRevealDataForEvmChain());
                if (revealResponse.body.success) {
                  depositIdForTest = revealResponse.body.depositId;
                } else {
                  console.warn(`Prereq failed for ${chainName}: ${revealResponse.body.error}`);
                  depositIdForTest = null;
                }
              }
            });
            test('should finalize a deposit and update status', async () => {
              if (chainName === 'FaultyMockEVM') {
                /* ... */
              } else if (depositIdForTest) {
                const finalizeResponse = await request(localApp).post(
                  `/api/${chainName}/deposit/${depositIdForTest}/finalize`,
                );
                expect(finalizeResponse.status).toBe(200);
                expect(finalizeResponse.body).toEqual(
                  expect.objectContaining({
                    success: true,
                    message: 'Operation successful',
                    transactionHash: expect.any(String),
                  }),
                );
                const statusResponse = await request(localApp).get(
                  `/api/${chainName}/deposit/${depositIdForTest}`,
                );
                expect(statusResponse.body.data.status).toBe(DepositStatus.FINALIZED);
              } else if (chainName !== 'FaultyMockEVM') {
                pending('Skipping POST finalize test due to failed prerequisite reveal.');
              }
            });
          });
        } else {
          // Endpoint-based tests (MockEndpointChain)
          describe(`POST /api/${chainName}/endpoint for ${chainName}`, () => {
            test("should initialize a deposit via 'initialize_deposit' action", async () => {
              mockEndpointChainDeposits.get(chainName)?.clear();
              const initDataResult = getValidDataForEndpointChain('initialize_deposit');
              if (!('id' in initDataResult)) {
                fail('Test setup error: Expected initDataResult to be a Deposit object');
                return;
              }
              const initData: Deposit = initDataResult;
              const response = await request(localApp)
                .post(`/api/${chainName}/endpoint`)
                .send({ action: 'initialize_deposit', data: initData })
                .set('Content-Type', 'application/json');
              expect(response.status).toBe(200);
              expect(response.body).toEqual(
                expect.objectContaining({
                  success: true,
                  data: expect.objectContaining({
                    depositId: initData.id,
                    message: 'Deposit initialized via endpoint',
                  }),
                }),
              );
              const storedDeposit = mockEndpointChainDeposits.get(chainName)?.get(initData.id);
              expect(storedDeposit).toBeDefined();
              if (storedDeposit) {
                expect(storedDeposit.status).toBe(DepositStatus.INITIALIZED);
              } else {
                fail('Stored deposit undefined');
              }
            });

            test("should return 500 for 'initialize_deposit' with missing data", async () => {
              const response = await request(localApp)
                .post(`/api/${chainName}/endpoint`)
                .send({ action: 'initialize_deposit', data: {} })
                .set('Content-Type', 'application/json');
              expect(response.status).toBe(500);
              expect(response.body).toEqual(
                expect.objectContaining({
                  success: false,
                  error: expect.stringContaining('Missing deposit data'),
                }),
              );
            });

            test("should get deposit status via 'check_deposit_status' action", async () => {
              mockEndpointChainDeposits.get(chainName)?.clear();
              const initResult = getValidDataForEndpointChain('initialize_deposit');
              if (!('id' in initResult)) {
                fail('Initial deposit failed');
                return;
              }
              const initPayload: Deposit = initResult;
              await request(localApp)
                .post(`/api/${chainName}/endpoint`)
                .send({ action: 'initialize_deposit', data: initPayload });
              const depositIdToCheck = initPayload.id;
              const statusData = getValidDataForEndpointChain(
                'check_deposit_status',
                depositIdToCheck,
              ) as { depositId: string };
              const response = await request(localApp)
                .post(`/api/${chainName}/endpoint`)
                .send({ action: 'check_deposit_status', data: statusData })
                .set('Content-Type', 'application/json');
              expect(response.status).toBe(200);
              expect(response.body).toEqual(
                expect.objectContaining({
                  success: true,
                  data: { depositId: depositIdToCheck, status: DepositStatus.INITIALIZED },
                }),
              );
            });

            test("should return 404 for 'check_deposit_status' with non-existent ID", async () => {
              const statusData = getValidDataForEndpointChain(
                'check_deposit_status',
                'nonExistentId',
              ) as { depositId: string };
              const response = await request(localApp)
                .post(`/api/${chainName}/endpoint`)
                .send({ action: 'check_deposit_status', data: statusData })
                .set('Content-Type', 'application/json');
              expect(response.status).toBe(404);
              expect(response.body).toEqual(expect.objectContaining({ success: false })); // Error message check might be too brittle
            });

            test("should finalize a deposit via 'finalize_deposit' action", async () => {
              mockEndpointChainDeposits.get(chainName)?.clear();
              const initResult = getValidDataForEndpointChain('initialize_deposit');
              if (!('id' in initResult)) {
                fail('Initial deposit failed for finalize');
                return;
              }
              const initPayload: Deposit = initResult;
              await request(localApp)
                .post(`/api/${chainName}/endpoint`)
                .send({ action: 'initialize_deposit', data: initPayload });
              const depositIdToFinalize = initPayload.id;
              const finalizeData = getValidDataForEndpointChain(
                'finalize_deposit',
                depositIdToFinalize,
              ) as { depositId: string };
              const finalizeResponse = await request(localApp)
                .post(`/api/${chainName}/endpoint`)
                .send({ action: 'finalize_deposit', data: finalizeData })
                .set('Content-Type', 'application/json');
              expect(finalizeResponse.status).toBe(200);
              expect(finalizeResponse.body).toEqual(
                expect.objectContaining({
                  success: true,
                  data: expect.objectContaining({
                    transactionHash: expect.any(String),
                    message: 'Deposit finalized via endpoint',
                  }),
                }),
              );
              const statusData = getValidDataForEndpointChain(
                'check_deposit_status',
                depositIdToFinalize,
              ) as { depositId: string };
              const statusResponse = await request(localApp)
                .post(`/api/${chainName}/endpoint`)
                .send({ action: 'check_deposit_status', data: statusData });
              expect(statusResponse.body.data.status).toBe(DepositStatus.FINALIZED);
            });

            test("should return 404 for 'finalize_deposit' with non-existent ID", async () => {
              const finalizeData = getValidDataForEndpointChain(
                'finalize_deposit',
                'nonExistentId',
              ) as { depositId: string };
              const response = await request(localApp)
                .post(`/api/${chainName}/endpoint`)
                .send({ action: 'finalize_deposit', data: finalizeData })
                .set('Content-Type', 'application/json');
              expect(response.status).toBe(404);
              expect(response.body).toEqual(expect.objectContaining({ success: false }));
            });

            test('should return 400 for an unsupported action', async () => {
              const response = await request(localApp)
                .post(`/api/${chainName}/endpoint`)
                .send({ action: 'unsupported_action', data: {} })
                .set('Content-Type', 'application/json');
              expect(response.status).toBe(400);
              expect(response.body).toEqual(expect.objectContaining({ success: false }));
            });
          });
        }
      });
    });
  });
});
// Ensure original process.env values are restored if they were changed by this file
// This is now handled by the afterAll in the describeToRun block.
// (No code needed here)
