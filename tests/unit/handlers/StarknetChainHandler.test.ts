// tests/unit/handlers/StarknetChainHandler.test.ts - Unit tests for StarknetChainHandler
//
// This suite tests the StarknetChainHandler's constructor, initialization, deposit logic, and error handling with extensive mocking of dependencies.

// =====================
// JEST.MOCK DEFINITIONS
// =====================

jest.mock('starknet', () => ({
  RpcProvider: jest.fn().mockImplementation((config) => ({
    nodeUrl: config.nodeUrl,
    getBlock: jest.fn().mockResolvedValue({ block_number: 1000 }),
    getEvents: jest.fn().mockResolvedValue({ events: [], continuation_token: undefined }),
  })),
  Account: jest.fn().mockImplementation((provider, address, privateKey) => ({
    provider,
    address,
    privateKey,
  })),
  hash: {
    starknetKeccak: jest.fn((eventName: string) => `keccak_hash_of_${eventName}`),
  },
  num: {
    toHex: jest.fn((val: any) => {
      if (typeof val === 'bigint') return `0x${val.toString(16)}`;
      if (typeof val === 'string' && val.startsWith('keccak_hash_of_')) return val; // Allow pre-hashed event names
      return `mock_hex_${String(val)}`;
    }),
  },
  events: {
    getAbiEvents: jest.fn(() => ({})), // Return an empty object or mock structure
    parseEvents: jest.fn((eventsToParse) => eventsToParse), // Pass through
  },
  CallData: {
    getAbiStruct: jest.fn(() => ({})),
    getAbiEnum: jest.fn(() => ({})),
    compile: jest.fn(),
  },
  shortString: {
    decodeShortString: jest.fn((str) => str),
    encodeShortString: jest.fn((str) => str),
  },
  json: {
    stringify: jest.fn((obj) => JSON.stringify(obj)),
    parse: jest.fn((str) => JSON.parse(str)),
  },
  stark: {
    formatExecutionResources: jest.fn((res) => res),
  },
}));

const mockConfigGetEnvImpl = jest.fn(
  (key: string, defaultValue?: string) => process.env[key] || defaultValue || '',
);
const mockConfigGetEnvOptionalImpl = jest.fn((key: string) => process.env[key]);
const mockConfigGetEnvOrThrowImpl = jest.fn((key: string) => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var ${key}`);
  return val;
});

const mockConfigObject = {
  getConfig: jest.fn(),
  getChainConfig: jest.fn(), // This will be set in beforeEach
  getEnv: mockConfigGetEnvImpl,
  getEnvOptional: mockConfigGetEnvOptionalImpl,
  getEnvOrThrow: mockConfigGetEnvOrThrowImpl,
  isTestnet: jest.fn().mockReturnValue(true),
};

// This mock now correctly represents the re-export structure of utils/Config.ts
jest.mock('../../../utils/Config', () => ({
  __esModule: true, // Important for ES modules
  Config: mockConfigObject, // Config is an object with methods
  ChainType: {
    // Enums are objects
    EVM: 'EVM',
    SOLANA: 'SOLANA',
    STARKNET: 'STARKNET',
  },
  Environment: {
    // Enums are objects
    LOCAL: 'local',
    TESTNET: 'testnet',
    MAINNET: 'mainnet',
  },
  // StarkNetSpecificConfig was a type, not needed here if not directly imported as value
}));

const mockGetFundingTxHashImpl = jest.fn().mockImplementation((tx: any | undefined) => {
  if (tx && tx.version !== undefined && tx.locktime !== undefined) {
    // Return a valid 66-character hex string (0x + 64 hex chars)
    return `0x${'a'.repeat(60)}${tx.version}${tx.locktime}ff`; // Example format
  }
  return '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; // Default valid hex
});
jest.mock('../../../utils/GetTransactionHash', () => ({
  getBitcoinTxHash: jest.fn().mockReturnValue('mock-btc-tx-hash'),
  getEthereumTxHash: jest.fn().mockReturnValue('mock-eth-tx-hash'),
  getFundingTxHash: mockGetFundingTxHashImpl,
  calculateTxId: jest.fn().mockReturnValue('mock-calculated-txid'),
}));

const mockAuditLogFunctions = {
  appendToAuditLog: jest.fn(),
  logDepositCreated: jest.fn(),
  logStatusChange: jest.fn(),
  logDepositInitialized: jest.fn(),
  logDepositFinalized: jest.fn(),
  logDepositDeleted: jest.fn(),
  logApiRequest: jest.fn(),
  logDepositError: jest.fn(),
  logGenericError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
};
jest.mock('../../../utils/AuditLog', () => mockAuditLogFunctions);

const mockDepositStoreImplementation = {
  getById: jest.fn(),
  getAll: jest.fn().mockResolvedValue([]),
  add: jest.fn(),
  update: jest.fn(),
  deleteById: jest.fn(),
  findOrCreate: jest.fn(),
  findByStatus: jest.fn().mockResolvedValue([]),
  getManyByIds: jest.fn().mockResolvedValue([]),
  getTotalDeposits: jest.fn().mockResolvedValue(0),
  getDepositVolume: jest.fn().mockResolvedValue(0),
};
jest.mock('../../../utils/DepositStore', () => ({
  DepositStore: mockDepositStoreImplementation,
}));

// =====================
// ACTUAL IMPORTS
// =====================
import * as ethers from 'ethers'; // Use namespace import for compatibility with mock
import { StarknetChainHandler } from '../../../handlers/StarknetChainHandler.js';
import { CHAIN_TYPE, NETWORK } from '../../../config/schemas/common.schema.js';
import type { StarknetChainConfig } from '../../../config/schemas/starknet.chain.schema.js';
import type { Deposit } from '../../../types/Deposit.type.js';
import type { FundingTransaction } from '../../../types/FundingTransaction.type.js';
import { DepositStatus } from '../../../types/DepositStatus.enum.js';
import type { Reveal } from '../../../types/Reveal.type.js';
import { formatStarkNetAddressForContract } from '../../../utils/starknetAddress.js';

// =====================
// TEST SUITE: StarknetChainHandler
// =====================

describe('StarknetChainHandler', () => {
  let handler: StarknetChainHandler;
  let mockFullStarknetConfig: StarknetChainConfig;
  const depositStoreMock = mockDepositStoreImplementation; // Use the direct mock object
  const auditLogMock = mockAuditLogFunctions; // Use the direct mock object
  const getFundingTxHashMock = mockGetFundingTxHashImpl; // Use the direct mock object

  beforeEach(async () => {
    jest.clearAllMocks();

    mockFullStarknetConfig = {
      chainName: 'StarknetTestnet',
      chainType: CHAIN_TYPE.STARKNET,
      network: NETWORK.TESTNET,
      l1Rpc: 'http://localhost:8545', // Validated URL format
      l2Rpc: 'http://localhost:9545', // Validated URL format
      l2WsRpc: 'ws://localhost:9546', // Validated URL format
      l1ContractAddress: '0x1234567890123456789012345678901234567890', // Valid Ethereum address
      l1BitcoinRedeemerAddress: '0x1111111111111111111111111111111111111111', // Valid Ethereum address
      l2WormholeGatewayAddress: '0x2222222222222222222222222222222222222222', // Valid Ethereum address
      l2WormholeChainId: 10019, // Example numeric ID for Starknet testnet
      l2StartBlock: 0,
      vaultAddress: '0x3333333333333333333333333333333333333333', // Valid Ethereum address
      l1Confirmations: 1,
      useEndpoint: false,
      supportsRevealDepositAPI: false,
      enableL2Redemption: false,
      // Valid StarkNet private key (0x + 1-64 hex chars)
      starknetPrivateKey: '0x0000000000000000000000000000000000000000000000000000000000000001',
      // Valid StarkNet address (0x + 1-64 hex chars)
      starknetDeployerAddress: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      starkGateBridgeAddress: '0x0987654321098765432109876543210987654321', // Valid Ethereum address
      l1FeeAmountWei: '100000',
      pollInterval: 10000,
      batchSize: 10,
      maxBlockRange: 100,
    };

    // Mock Config.getChainConfig() globally for this test suite
    mockConfigObject.getChainConfig.mockReturnValue(mockFullStarknetConfig);

    mockConfigGetEnvImpl.mockImplementation((key: string, defaultValue?: string) => {
      if (key === 'STARKNET_TESTNET_DEPLOYER_PRIVATE_KEY')
        return mockFullStarknetConfig.starknetPrivateKey;
      if (key === 'STARKNET_TESTNET_DEPLOYER_ADDRESS')
        return mockFullStarknetConfig.starknetDeployerAddress;
      const envValue = process.env[key];
      if (envValue !== undefined) return envValue;
      if (defaultValue !== undefined) return defaultValue;
      return ''; // Default empty string if not found and no default
    });

    handler = new StarknetChainHandler(mockFullStarknetConfig);
    await handler.initialize(); // This is crucial

    // --- BEGIN DEBUG LOGS ---
    /* console.log(
      'TEST_DEBUG: typeof handler.l1DepositorContract?.initializeDeposit:',
      typeof (handler as any).l1DepositorContract?.initializeDeposit,
    );
    if ((handler as any).l1DepositorContract) {
      console.log(
        'TEST_DEBUG: handler.l1DepositorContract.initializeDeposit === mockContractSpyReturnInstance.initializeDeposit:',
        (handler as any).l1DepositorContract.initializeDeposit ===
          mockContractSpyReturnInstance.initializeDeposit,
      );
      console.log(
        'TEST_DEBUG: mockContractSpyReturnInstance.initializeDeposit is jest.fn():',
        jest.isMockFunction(mockContractSpyReturnInstance.initializeDeposit),
      );
      console.log(
        'TEST_DEBUG: handler.l1DepositorContract.initializeDeposit is jest.fn():',
        jest.isMockFunction((handler as any).l1DepositorContract.initializeDeposit),
      );
    } */
    // --- END DEBUG LOGS ---
  });

  // =====================
  // Constructor and Initialization
  // =====================

  describe('Constructor and Initialization', () => {
    it('should construct and initialize L1 components successfully with valid config', () => {
      expect(handler).toBeInstanceOf(StarknetChainHandler);
      // Check that L1 components are initialized by initialize()
      expect((handler as any).l1Signer).toBeDefined();
      expect((handler as any).nonceManagerL1).toBeDefined();
      expect((handler as any).l1DepositorContract).toBeDefined();
      expect((handler as any).l1DepositorContractProvider).toBeDefined(); // This is the read-only contract
    });

    it('should throw if L1 RPC is not configured (handled by Zod schema parsing in constructor)', () => {
      // Zod performs validation, so attempting to create with invalid l1Rpc will throw
      const invalidConfig = { ...mockFullStarknetConfig, l1Rpc: 'not_a_url' };
      expect(() => new StarknetChainHandler(invalidConfig)).toThrow();
    });

    it('should throw if l1ContractAddress is missing (handled by Zod schema)', () => {
      const configWithoutL1Address = {
        ...mockFullStarknetConfig,
        l1ContractAddress: 'not_an_address' as any, // Force invalid type for Zod
      };
      expect(() => new StarknetChainHandler(configWithoutL1Address)).toThrow();
    });
  });

  // =====================
  // initializeDeposit
  // =====================

  describe('initializeDeposit', () => {
    let mockDeposit: Deposit;
    const mockFundingTx: FundingTransaction = {
      version: '2', // As per type, string
      locktime: '0', // As per type, string
      inputVector: '0xinputs', // hex string
      outputVector: '0xoutputs', // hex string
    };
    const mockRevealData: Reveal = {
      fundingOutputIndex: 0,
      walletPubKeyHash: '0x1111111111111111111111111111111111111111',
      refundPubKeyHash: '0x2222222222222222222222222222222222222222',
      refundLocktime: '0x00000000',
      vault: '0x3333333333333333333333333333333333333333',
      blindingFactor: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    };

    beforeEach(() => {
      // Reset mock store state for each test
      depositStoreMock.getById.mockResolvedValue(null); // Default to deposit not found
      depositStoreMock.update.mockResolvedValue(undefined);

      mockDeposit = {
        id: `mock-deposit-id-${getFundingTxHashMock(mockFundingTx)}-${mockRevealData.fundingOutputIndex}`,
        chainName: mockFullStarknetConfig.chainName,
        status: DepositStatus.QUEUED,
        owner: 'mockOwner',
        receipt: {
          depositor: 'mockDepositor',
          walletPublicKeyHash: mockRevealData.walletPubKeyHash,
          refundPublicKeyHash: mockRevealData.refundPubKeyHash,
          refundLocktime: mockRevealData.refundLocktime,
          blindingFactor: mockRevealData.blindingFactor,
          extraData: '0xdeadbeefcafebabe',
        },
        fundingTxHash: getFundingTxHashMock(mockFundingTx),
        outputIndex: mockRevealData.fundingOutputIndex,
        L1OutputEvent: {
          fundingTx: mockFundingTx,
          reveal: mockRevealData,
          l2Sender: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          l2DepositOwner: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        },
        hashes: {
          btc: { btcTxHash: 'mockBtcTxHash' },
          eth: { initializeTxHash: null, finalizeTxHash: null },
          solana: { bridgeTxHash: null },
          starknet: { l1BridgeTxHash: null, l2TxHash: null },
        },
        dates: {
          createdAt: Date.now(),
          lastActivityAt: Date.now(),
          initializationAt: null,
          finalizationAt: null,
          bridgedAt: null,
          awaitingWormholeVAAMessageSince: null,
        },
        error: null,
        wormholeInfo: {
          bridgingAttempted: false,
          transferSequence: null,
          txHash: null,
        },
      };
      depositStoreMock.getById.mockResolvedValue(mockDeposit); // Assume deposit exists for update tests
    });

    it('should successfully initialize a deposit and return the transaction receipt', async () => {
      const mockReceipt = {
        to: mockFullStarknetConfig.l1ContractAddress,
        from: '0xMockL1SignerAddress',
        contractAddress: mockFullStarknetConfig.l1ContractAddress,
        transactionIndex: 1,
        gasUsed: ethers.BigNumber.from(21000),
        logsBloom: '0x' + '0'.repeat(512),
        blockHash: '0xMockBlockHash',
        transactionHash: '0xInitTxHashSuccess000000000000000000000000000000000000000000000000',
        logs: [],
        blockNumber: 123,
        confirmations: mockFullStarknetConfig.l1Confirmations || 1,
        cumulativeGasUsed: ethers.BigNumber.from(21000),
        effectiveGasPrice: ethers.BigNumber.from(1000000000),
        byzantium: true,
        type: 2,
        status: 1, // Success
      } as ethers.providers.TransactionReceipt;

      // Mock the L1 depositor contract interaction
      (handler as any).l1DepositorContract.initializeDeposit.mockResolvedValue({
        wait: jest.fn().mockResolvedValue(mockReceipt),
      });

      const mockFundingTx: FundingTransaction = {
        version: '2',
        locktime: '0',
        inputVector: '0xinputs',
        outputVector: '0xoutputs',
      };

      const mockReveal: Reveal = {
        fundingOutputIndex: 0,
        blindingFactor: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        walletPubKeyHash: '0x1111111111111111111111111111111111111111',
        refundPubKeyHash: '0x2222222222222222222222222222222222222222',
        refundLocktime: '0x00000000',
        vault: '0x3333333333333333333333333333333333333333',
      };

      const mockDeposit: Deposit = {
        id: `mock-deposit-id-${getFundingTxHashMock(mockFundingTx)}-${mockReveal.fundingOutputIndex}`,
        chainName: mockFullStarknetConfig.chainName,
        fundingTxHash: getFundingTxHashMock(mockFundingTx),
        outputIndex: mockReveal.fundingOutputIndex,
        owner: 'mockOwner',
        status: DepositStatus.QUEUED,
        receipt: {
          depositor: 'mockDepositor',
          blindingFactor: mockReveal.blindingFactor,
          walletPublicKeyHash: mockReveal.walletPubKeyHash,
          refundPublicKeyHash: mockReveal.refundPubKeyHash,
          refundLocktime: mockReveal.refundLocktime,
          extraData: '0xdeadbeefcafebabe',
        },
        hashes: {
          btc: { btcTxHash: 'mockBtcTxHash' },
          eth: { initializeTxHash: null, finalizeTxHash: null },
          solana: { bridgeTxHash: null },
          starknet: { l1BridgeTxHash: null, l2TxHash: null },
        },
        L1OutputEvent: {
          fundingTx: mockFundingTx,
          reveal: mockReveal,
          l2DepositOwner: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          l2Sender: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
        dates: {
          createdAt: Date.now() - 1000,
          initializationAt: null,
          finalizationAt: null,
          awaitingWormholeVAAMessageSince: null,
          bridgedAt: null,
          lastActivityAt: Date.now() - 1000,
        },
        wormholeInfo: {
          txHash: null,
          transferSequence: null,
          bridgingAttempted: false,
        },
        error: null,
      };

      depositStoreMock.getById.mockResolvedValue(mockDeposit);

      const result = await handler.initializeDeposit(mockDeposit);
      expect(result).toEqual(mockReceipt);

      console.log('Test 1 - Expected ID:', mockDeposit.id);
      if (depositStoreMock.update.mock.calls.length > 0) {
        console.log(
          'Test 1 - Actual ID received by mock:',
          depositStoreMock.update.mock.calls[0][0],
        );
      }

      expect((handler as any).l1DepositorContract.initializeDeposit).toHaveBeenCalledWith(
        {
          version: mockDeposit.L1OutputEvent?.fundingTx.version,
          inputVector: mockDeposit.L1OutputEvent?.fundingTx.inputVector,
          outputVector: mockDeposit.L1OutputEvent?.fundingTx.outputVector,
          locktime: mockDeposit.L1OutputEvent?.fundingTx.locktime,
        },
        {
          fundingOutputIndex: mockDeposit.L1OutputEvent?.reveal.fundingOutputIndex,
          blindingFactor: mockDeposit.L1OutputEvent?.reveal.blindingFactor,
          walletPubKeyHash: mockDeposit.L1OutputEvent?.reveal.walletPubKeyHash,
          refundPubKeyHash: mockDeposit.L1OutputEvent?.reveal.refundPubKeyHash,
          refundLocktime: mockDeposit.L1OutputEvent?.reveal.refundLocktime,
          vault: mockDeposit.L1OutputEvent?.reveal.vault,
        },
        formatStarkNetAddressForContract(mockDeposit.L1OutputEvent?.l2DepositOwner || ''),
        {
          value: ethers.BigNumber.from(mockFullStarknetConfig.l1FeeAmountWei),
        },
      );

      // Verify DepositStore.update was called
      // expect(depositStoreMock.update).toHaveBeenCalled(); // Keep this commented for now

      // Argument checking block for successful initialization:
      expect(depositStoreMock.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: mockDeposit.id }),
      );

      // Capture the argument and assert properties individually
      const updatedDepositArg = depositStoreMock.update.mock.calls[0][0] as Deposit;
      expect(updatedDepositArg.status).toEqual(DepositStatus.INITIALIZED);
      expect(updatedDepositArg.statusMessage).toEqual('Successfully initialized on L1.');
      expect(updatedDepositArg.hashes?.eth?.initializeTxHash).toEqual(mockReceipt.transactionHash);
      expect(updatedDepositArg.dates.initializationAt).toEqual(expect.any(Number));
      expect(updatedDepositArg.dates.lastActivityAt).toEqual(expect.any(Number));
      expect(updatedDepositArg.error).toBeNull();

      // Check that initializationAt and lastActivityAt are close to now
      expect(updatedDepositArg.dates.initializationAt).toBeCloseTo(Date.now(), -3); // within 1 sec
      expect(updatedDepositArg.dates.lastActivityAt).toBeCloseTo(Date.now(), -3); // within 1 sec

      expect(auditLogMock.logStatusChange).toHaveBeenCalledWith(
        expect.objectContaining({ id: mockDeposit.id }),
        DepositStatus.INITIALIZED,
        DepositStatus.QUEUED, // Assuming initial status from beforeEach is QUEUED
        // No 4th argument expected here based on implementation
      );

      expect(auditLogMock.logDepositError).not.toHaveBeenCalled();
    });

    it('should handle error during L1 transaction and update deposit status', async () => {
      const expectedError = new Error('L1 transaction failed');
      // Mock the L1 depositor contract to reject
      (handler as any).l1DepositorContract.initializeDeposit.mockRejectedValueOnce(expectedError);

      // Expect the promise to resolve to undefined, as the error is caught and handled
      await expect(handler.initializeDeposit(mockDeposit)).resolves.toBeUndefined();

      console.log('Test 2 - Expected ID:', mockDeposit.id);
      if (depositStoreMock.update.mock.calls.length > 0) {
        console.log(
          'Test 2 - Actual ID received by mock:',
          depositStoreMock.update.mock.calls[0][0],
        );
      }

      // Verify DepositStore.update was called
      // expect(depositStoreMock.update).toHaveBeenCalled(); // Keep this commented for now

      // Argument checking block for error during L1 transaction:
      expect(depositStoreMock.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: mockDeposit.id }),
      );

      // Capture the argument and assert properties individually
      const updatedErrorDepositArg = depositStoreMock.update.mock.calls[0][0] as Deposit;
      expect(updatedErrorDepositArg.status).toEqual(DepositStatus.ERROR_SENDING_L1_TX);
      expect(updatedErrorDepositArg.statusMessage).toEqual('Error: L1 transaction failed');
      expect(updatedErrorDepositArg.error).toEqual(
        expect.stringContaining('L1 transaction failed'),
      );
      expect(updatedErrorDepositArg.hashes?.eth?.initializeTxHash).toBeNull();
      expect(updatedErrorDepositArg.dates.initializationAt).toBeNull();
      expect(updatedErrorDepositArg.dates.lastActivityAt).toEqual(expect.any(Number));

      // Check that lastActivityAt is close to now
      expect(updatedErrorDepositArg.dates.lastActivityAt).toBeCloseTo(Date.now(), -3); // within 1 sec

      // Verify audit log for the error
      expect(auditLogMock.logDepositError).toHaveBeenCalledWith(
        mockDeposit.id,
        expect.stringContaining('Failed to initialize deposit: L1 transaction failed'),
        expect.objectContaining({ message: 'L1 transaction failed' }),
        mockDeposit.chainName,
      );

      // Best practice: logStatusChange should NOT be called for error transitions
      expect(auditLogMock.logStatusChange).not.toHaveBeenCalled();
    });
  });

  // =====================
  // Additional describe blocks for other methods/logic
  // =====================

  // ...
});

// Logger mock should be defined after all other mocks or at the very top if not hoisted.
// Jest hoists jest.mock calls, so their definition order relative to imports isn't an issue.
jest.mock('../../../utils/Logger', () => {
  const loggerInstance = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setLogLevel: jest.fn(),
    getLogLevel: jest.fn().mockReturnValue('info'),
    child: jest.fn().mockReturnThis(), // Important for logger.child().error() patterns
  };
  return {
    __esModule: true, // For ES module imports
    default: loggerInstance,
    // Also mock named exports if they are used by the code under test
    logErrorContext: jest.fn(),
    logChainCronError: jest.fn(),
    logGlobalCronError: jest.fn(),
  };
});
