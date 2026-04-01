import * as Sentry from '@sentry/node';
import { ethers } from 'ethers';
import { CHAIN_TYPE, NETWORK } from '../../../config/schemas/common.schema.js';
import {
  type SuiChainConfig,
  SuiChainConfigSchema,
} from '../../../config/schemas/sui.chain.schema.js';
import { RECOVERY_DELAY_MS } from '../../../handlers/BaseChainHandler.js';
import { SuiChainHandler } from '../../../handlers/SuiChainHandler.js';
import type { Deposit } from '../../../types/Deposit.type.js';
import { DepositStatus } from '../../../types/DepositStatus.enum.js';
import { DepositStore } from '../../../utils/DepositStore.js';
import * as depositUtils from '../../../utils/Deposits.js';
import logger from '../../../utils/Logger.js';
import * as wormholeVAAModule from '../../../utils/WormholeVAA.js';

// Mock external dependencies
jest.mock('../../../utils/DepositStore');
jest.mock('../../../utils/Logger');
jest.mock('../../../utils/Deposits');
jest.mock('../../../utils/AuditLog');
jest.mock('../../../utils/BitcoinTransactionParser');
jest.mock('../../../utils/SuiMoveEventParser');
jest.mock('../../../utils/WormholeVAA');
jest.mock('@sentry/node');

// Mock SUI SDK with more defensive mocking
jest.mock('@mysten/sui/client', () => {
  const mockSuiClient = {
    getLatestCheckpointSequenceNumber: jest.fn().mockResolvedValue('12345'),
    subscribeEvent: jest.fn().mockResolvedValue(() => jest.fn()),
    queryEvents: jest.fn().mockResolvedValue({
      data: [],
      hasNextPage: false,
      nextCursor: null,
    }),
    signAndExecuteTransaction: jest.fn().mockResolvedValue({
      digest: 'mock-transaction-digest',
      effects: {
        status: { status: 'success' },
      },
    }),
  };

  return {
    SuiClient: jest.fn().mockImplementation(() => mockSuiClient),
    getFullnodeUrl: jest.fn().mockReturnValue('https://fullnode.testnet.sui.io'),
    __esModule: true,
  };
});

jest.mock('@mysten/sui/keypairs/ed25519', () => {
  const mockPublicKey = {
    toSuiAddress: jest
      .fn()
      .mockReturnValue('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'),
  };

  const mockKeypair = {
    getPublicKey: jest.fn().mockReturnValue(mockPublicKey),
    publicKey: jest.fn().mockReturnValue('mock-public-key'),
    signData: jest.fn().mockReturnValue('mock-signature'),
  };

  return {
    Ed25519Keypair: {
      fromSecretKey: jest.fn().mockReturnValue(mockKeypair),
    },
    __esModule: true,
  };
});

// Create shared mock transaction instance to track calls across tests
const sharedMockTransaction = {
  moveCall: jest.fn(),
  setGasPayment: jest.fn(),
  object: jest.fn().mockReturnValue('mock-object-ref'),
  pure: Object.assign(jest.fn().mockReturnValue('mock-pure-ref'), {
    vector: jest.fn().mockReturnValue('mock-vector-ref'),
  }),
};

jest.mock('@mysten/sui/transactions', () => {
  return {
    Transaction: jest.fn().mockImplementation(() => sharedMockTransaction),
    __esModule: true,
  };
});

jest.mock('@mysten/bcs', () => ({
  fromBase64: jest.fn().mockReturnValue(Uint8Array.from({ length: 32 }, () => 0)),
  bcs: {
    vector: jest.fn().mockReturnValue({
      serialize: jest.fn(),
      deserialize: jest.fn(),
      transform: jest.fn(),
    }),
    bytes: jest.fn().mockReturnValue({
      serialize: jest.fn(),
      deserialize: jest.fn(),
      transform: jest.fn(),
    }),
  },
  __esModule: true,
}));

jest.mock('@mysten/sui/cryptography', () => ({
  decodeSuiPrivateKey: jest.fn().mockReturnValue({
    schema: 'ED25519',
    secretKey: Uint8Array.from({ length: 32 }, () => 0),
  }),
  __esModule: true,
}));

// Mock the config module to prevent loading all chain configurations during unit tests
jest.mock('../../../config/index.js', () => ({
  chainConfigs: {},
  getAvailableChainKeys: () => ['suiTestnet'],
}));

// Mock Wormhole SDK
jest.mock('@wormhole-foundation/sdk', () => ({
  Wormhole: {
    parseAddress: jest.fn().mockReturnValue('mock-address'),
  },
}));

// Default config for tests
const mockSuiConfig: SuiChainConfig = {
  ...SuiChainConfigSchema.parse({
    // CommonChainConfigSchema fields
    chainName: 'SuiTestnet',
    network: NETWORK.TESTNET,
    l1Confirmations: 3,
    l1Rpc: 'http://l1-rpc.test',
    l2Rpc: 'https://fullnode.testnet.sui.io',
    l2WsRpc: 'wss://fullnode.testnet.sui.io',
    l1BitcoinDepositorAddress: '0x1234567890123456789012345678901234567890',
    vaultAddress: '0xabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcde',
    l1BitcoinDepositorStartBlock: 1,
    l2BitcoinDepositorStartBlock: 0,
    enableL2Redemption: false,
    useEndpoint: false,

    // SuiChainBaseSchema fields
    chainType: CHAIN_TYPE.SUI,
    suiPrivateKey: 'dGVzdC1zdWktcHJpdmF0ZS1rZXktZm9yLXRlc3Rpbmc=', // base64 encoded test key (longer)
    suiGasObjectId: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    l2BitcoinDepositorAddress:
      '0x3d78316ce8ee3fe48d7ff85cdc2d0df9d459f43d802d96f58f7b59984c2dd3ae::bitcoin_depositor',
    // l2WormholeGatewayAddress and l2WormholeChainId removed - not used in Sui chains
    // (replaced by gatewayStateId and native Wormhole SDK integration)

    // Additional required fields for SUI
    wormholeCoreId: '0x5306f64e312b581766351c07af79c72fcb1cd25147157fdc2f8ad76de9a3fb6a',
    tokenBridgeId: '0xc57508ee0d4595e5a8728974a4a93a787d38f339757230d441e895422c07aba9',
    wrappedTbtcType:
      '0x3d78316ce8ee3fe48d7ff85cdc2d0df9d459f43d802d96f58f7b59984c2dd3ae::tbtc::TBTC',
    receiverStateId: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    gatewayStateId: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde0',
    capabilitiesId: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd01',
    treasuryId: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abc012',
    tokenStateId: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab0123',
  }),
  // Add l2PackageId manually for tests
  l2PackageId: '0x3d78316ce8ee3fe48d7ff85cdc2d0df9d459f43d802d96f58f7b59984c2dd3ae',
};

describe('SuiChainHandler', () => {
  let handler: SuiChainHandler;
  let mockDepositStore: jest.Mocked<typeof DepositStore>;
  let mockDepositsUtil: jest.Mocked<typeof depositUtils>;

  // Mock wormhole object
  const mockWormhole = {
    getChain: jest.fn().mockReturnValue({
      parseTransaction: jest.fn().mockResolvedValue([
        {
          chain: 'Ethereum',
          emitter: '0x123',
          sequence: BigInt(1),
        },
      ]),
    }),
    getVaa: jest.fn().mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3, 4]),
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Clear the shared mock transaction calls
    sharedMockTransaction.moveCall.mockClear();
    sharedMockTransaction.object.mockClear();
    (sharedMockTransaction.pure as jest.Mock).mockClear();
    (sharedMockTransaction.pure.vector as jest.Mock).mockClear();
    sharedMockTransaction.setGasPayment.mockClear();

    // Setup mocked modules
    mockDepositStore = DepositStore as jest.Mocked<typeof DepositStore>;
    mockDepositsUtil = depositUtils as jest.Mocked<typeof depositUtils>;

    // Mock BitcoinTransactionParser functions
    const BitcoinTransactionParser = require('../../../utils/BitcoinTransactionParser.js');
    BitcoinTransactionParser.parseFundingTransaction = jest.fn().mockReturnValue({
      version: '01000000',
      inputVector: 'mock_input_vector',
      outputVector: 'mock_output_vector',
      locktime: '00000000',
    });
    BitcoinTransactionParser.parseReveal = jest.fn().mockReturnValue({
      fundingOutputIndex: 1,
      blindingFactor: '0x' + '00'.repeat(32),
      walletPubKeyHash: '0x' + '00'.repeat(20),
      refundPubKeyHash: '0x' + '00'.repeat(20),
      refundLocktime: '0',
      vault: '0x' + '00'.repeat(32),
    });

    // Mock SuiMoveEventParser functions
    const SuiMoveEventParser = require('../../../utils/SuiMoveEventParser.js');
    SuiMoveEventParser.parseDepositInitializedEvent = jest.fn();

    // Setup default mock implementations
    mockDepositStore.getById = jest.fn().mockResolvedValue(null);
    mockDepositStore.getByStatus = jest.fn().mockResolvedValue([]);
    mockDepositStore.create = jest.fn().mockResolvedValue(undefined);
    mockDepositStore.update = jest.fn().mockResolvedValue(undefined);
    (mockDepositsUtil as any).updateToAwaitingWormholeVAA = jest.fn().mockResolvedValue(undefined);
    (mockDepositsUtil as any).updateToBridgedDeposit = jest.fn().mockResolvedValue(undefined);
    (mockDepositsUtil as any).createDeposit = jest.fn().mockReturnValue({
      id: 'mock-deposit-id',
      chainId: 'SuiTestnet',
      status: DepositStatus.INITIALIZED,
      fundingTxHash: 'mock-funding-tx-hash',
      outputIndex: 1,
      L1OutputEvent: {
        l2DepositOwner: '0x0506070800000000000000000000000000000000000000000000000000000000',
        l2Sender: '0x090a0b0c00000000000000000000000000000000000000000000000000000000',
      },
    });

    // Create handler instance
    handler = new SuiChainHandler(mockSuiConfig);

    // Mock the wormhole property
    (handler as any).wormhole = mockWormhole;
  });

  describe('Constructor', () => {
    it('should create a SuiChainHandler instance with valid config', () => {
      expect(handler).toBeInstanceOf(SuiChainHandler);
      expect(handler.config.chainType).toBe(CHAIN_TYPE.SUI);
      expect(handler.config.chainName).toBe('SuiTestnet');
    });

    it('should throw error with invalid chain type', () => {
      const invalidConfig = {
        ...mockSuiConfig,
        chainType: CHAIN_TYPE.EVM,
      } as any;

      expect(() => new SuiChainHandler(invalidConfig)).toThrow(
        'Incorrect chain type Evm provided to SuiChainHandler.',
      );
    });
  });

  describe('initializeL2', () => {
    it('should initialize Sui client with proper configuration', async () => {
      await (handler as any).initializeL2();

      expect((handler as any).suiClient).toBeDefined();
      expect((handler as any).keypair).toBeDefined();
      expect((handler as any).suiWormholeContext).toBeDefined();
    });

    it('should warn when L2 RPC is not configured', async () => {
      const configWithoutL2Rpc = { ...mockSuiConfig };
      (configWithoutL2Rpc as any).l2Rpc = undefined;
      const handlerWithoutL2Rpc = new SuiChainHandler(configWithoutL2Rpc as any);

      await (handlerWithoutL2Rpc as any).initializeL2();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Sui L2 RPC not configured'),
      );
    });

    it('should handle initialization errors gracefully', async () => {
      const { SuiClient } = require('@mysten/sui/client');
      SuiClient.mockImplementationOnce(() => {
        throw new Error('Connection failed');
      });

      await expect((handler as any).initializeL2()).rejects.toThrow('Connection failed');
    });
  });

  describe('setupL2Listeners', () => {
    beforeEach(async () => {
      await (handler as any).initializeL2();
    });

    it('should set up event listeners when not using endpoint', async () => {
      jest.useFakeTimers();

      await (handler as any).setupL2Listeners();

      // Verify that polling interval was set
      expect((handler as any).pollingInterval).toBeDefined();

      // Fast-forward time to trigger the interval callback
      jest.advanceTimersByTime(5000);

      // Wait for the async callback to complete
      await Promise.resolve();

      // Verify queryEvents was called with correct parameters
      expect((handler as any).suiClient.queryEvents).toHaveBeenCalledWith({
        query: {
          MoveModule: {
            package: '0x3d78316ce8ee3fe48d7ff85cdc2d0df9d459f43d802d96f58f7b59984c2dd3ae',
            module: 'BitcoinDepositor',
          },
        },
        cursor: null,
        limit: 50,
        order: 'ascending',
      });

      jest.useRealTimers();
    });

    it('should cleanup polling interval on cleanup', async () => {
      jest.useFakeTimers();

      await (handler as any).setupL2Listeners();
      expect((handler as any).pollingInterval).toBeDefined();

      await (handler as any).cleanup();
      expect((handler as any).pollingInterval).toBeNull();

      jest.useRealTimers();
    });

    it('should skip listeners when using endpoint', async () => {
      const endpointConfig = { ...mockSuiConfig, useEndpoint: true };
      const endpointHandler = new SuiChainHandler(endpointConfig);

      // Mock the wormhole property before initializeL2
      (endpointHandler as any).wormhole = mockWormhole;

      await (endpointHandler as any).initializeL2();

      await (endpointHandler as any).setupL2Listeners();

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Sui L2 Listeners skipped'));
    });
  });

  describe('getLatestBlock', () => {
    beforeEach(async () => {
      await (handler as any).initializeL2();
    });

    it('should return latest checkpoint sequence number', async () => {
      const latestBlock = await handler.getLatestBlock();

      expect(latestBlock).toBe(12345);
      expect((handler as any).suiClient.getLatestCheckpointSequenceNumber).toHaveBeenCalled();
    });

    it('should return 0 when using endpoint', async () => {
      const endpointConfig = { ...mockSuiConfig, useEndpoint: true };
      const endpointHandler = new SuiChainHandler(endpointConfig);

      const latestBlock = await endpointHandler.getLatestBlock();

      expect(latestBlock).toBe(0);
    });

    it('should handle errors and return 0', async () => {
      (handler as any).suiClient.getLatestCheckpointSequenceNumber.mockRejectedValueOnce(
        new Error('RPC Error'),
      );

      const latestBlock = await handler.getLatestBlock();

      expect(latestBlock).toBe(0);
    });
  });

  describe('checkForPastDeposits', () => {
    beforeEach(async () => {
      await (handler as any).initializeL2();
    });

    it('should query past events within time range', async () => {
      const options = { pastTimeInMinutes: 60, latestBlock: 12345 };

      await handler.checkForPastDeposits(options);

      expect((handler as any).suiClient.queryEvents).toHaveBeenCalledWith({
        query: {
          MoveModule: {
            package: '0x3d78316ce8ee3fe48d7ff85cdc2d0df9d459f43d802d96f58f7b59984c2dd3ae',
            module: 'BitcoinDepositor',
          },
        },
        cursor: null,
        limit: 50,
        order: 'descending',
      });
    });

    it('should skip when using endpoint', async () => {
      const endpointConfig = { ...mockSuiConfig, useEndpoint: true };
      const endpointHandler = new SuiChainHandler(endpointConfig);

      await endpointHandler.checkForPastDeposits({ pastTimeInMinutes: 60, latestBlock: 12345 });

      // Should not call queryEvents
      expect((handler as any).suiClient?.queryEvents).not.toHaveBeenCalled();
    });
  });

  describe('supportsPastDepositCheck', () => {
    it('should return true when L2 RPC is configured and not using endpoint', () => {
      const supports = handler.supportsPastDepositCheck();

      expect(supports).toBe(true);
    });

    it('should return false when using endpoint', () => {
      const endpointConfig = { ...mockSuiConfig, useEndpoint: true };
      const endpointHandler = new SuiChainHandler(endpointConfig);

      const supports = endpointHandler.supportsPastDepositCheck();

      expect(supports).toBe(false);
    });

    it('should return false when L2 RPC is not configured', () => {
      const noRpcConfig = { ...mockSuiConfig };
      (noRpcConfig as any).l2Rpc = undefined;
      const noRpcHandler = new SuiChainHandler(noRpcConfig as any);

      const supports = noRpcHandler.supportsPastDepositCheck();

      expect(supports).toBe(false);
    });
  });

  describe('finalizeDeposit', () => {
    let mockDeposit: Deposit;
    let mockReceipt: any;

    beforeEach(async () => {
      await (handler as any).initializeL2();

      mockDeposit = {
        id: 'test-deposit-id',
        chainId: 'SuiTestnet',
        status: DepositStatus.INITIALIZED,
        wormholeInfo: {
          txHash: '0xtest-tx-hash',
          transferSequence: '123',
          bridgingAttempted: false,
        },
      } as Deposit;

      mockReceipt = {
        transactionHash: '0xtest-finalize-hash',
        logs: [
          {
            // address must match config.l1BitcoinDepositorAddress for the filter to pass
            address: mockSuiConfig.l1BitcoinDepositorAddress,
            topics: [ethers.utils.id('TokensTransferredWithPayload(uint256,bytes32,uint64)')],
          },
        ],
      };

      // SuiChainHandler.finalizeDeposit calls submitFinalizationTx directly (not super.finalizeDeposit)
      (handler as any).submitFinalizationTx = jest.fn().mockResolvedValue(mockReceipt);

      // Mock the l1BitcoinDepositorProvider with interface, queryFilter, and filters
      // so that both receipt-based parsing and block-range search are properly exercised
      (handler as any).l1BitcoinDepositorProvider = {
        interface: {
          getEventTopic: jest
            .fn()
            .mockReturnValue(
              ethers.utils.id('TokensTransferredWithPayload(uint256,bytes32,uint64)'),
            ),
          parseLog: jest.fn().mockReturnValue({
            name: 'TokensTransferredWithPayload',
            args: { transferSequence: ethers.BigNumber.from(123) },
          }),
        },
        queryFilter: jest.fn().mockResolvedValue([]),
        filters: {
          DepositFinalized: jest.fn().mockReturnValue({
            topics: [ethers.utils.id('DepositFinalized(uint256,bytes32,address,uint256,uint256)')],
          }),
        },
      };

      // Mock l1Provider for block-range search receipt fetching
      (handler as any).l1Provider = {
        getTransactionReceipt: jest.fn().mockResolvedValue({
          transactionHash: '0xevent-tx-hash',
          blockNumber: 100,
          logs: [],
        }),
      };
    });

    it('should process finalization and update to awaiting Wormhole VAA', async () => {
      const result = await handler.finalizeDeposit(mockDeposit);

      expect(result).toBe(mockReceipt);
      expect(mockDepositsUtil.updateToFinalizedAwaitingVAA).toHaveBeenCalledWith(
        mockDeposit,
        '0xtest-finalize-hash',
        '123',
      );
    });

    it('should return early if submitFinalizationTx fails', async () => {
      (handler as any).submitFinalizationTx = jest.fn().mockResolvedValueOnce(undefined);

      const result = await handler.finalizeDeposit(mockDeposit);

      expect(result).toBeUndefined();
      expect(mockDepositsUtil.updateToFinalizedAwaitingVAA).not.toHaveBeenCalled();
    });

    it('should handle missing transfer sequence gracefully', async () => {
      const receiptWithoutTransferSequence = {
        ...mockReceipt,
        logs: [],
      };

      (handler as any).submitFinalizationTx = jest
        .fn()
        .mockResolvedValueOnce(receiptWithoutTransferSequence);

      const result = await handler.finalizeDeposit(mockDeposit);

      expect(result).toBe(receiptWithoutTransferSequence);
      expect(mockDepositsUtil.updateToFinalizedAwaitingVAA).not.toHaveBeenCalled();
      expect(mockDepositsUtil.updateToFinalizedDeposit).toHaveBeenCalledWith(
        mockDeposit,
        { hash: receiptWithoutTransferSequence.transactionHash },
        'transferSequence_not_found',
      );
    });
  });

  describe('processWormholeBridging', () => {
    let mockDeposits: Deposit[];

    beforeEach(async () => {
      await (handler as any).initializeL2();

      mockDeposits = [
        {
          id: 'deposit-1',
          status: DepositStatus.AWAITING_WORMHOLE_VAA,
          wormholeInfo: {
            txHash: '0xtest-tx-hash-1',
            transferSequence: '123',
            bridgingAttempted: false,
          },
        } as Deposit,
        {
          id: 'deposit-2',
          status: DepositStatus.AWAITING_WORMHOLE_VAA,
          wormholeInfo: {
            txHash: '0xtest-tx-hash-2',
            transferSequence: '456',
            bridgingAttempted: false,
          },
        } as Deposit,
      ];

      mockDepositStore.getByStatus.mockResolvedValue(mockDeposits);
    });

    it('should process all deposits awaiting Wormhole VAA', async () => {
      await handler.processWormholeBridging();

      expect(mockDepositStore.getByStatus).toHaveBeenCalledWith(
        DepositStatus.AWAITING_WORMHOLE_VAA,
        'SuiTestnet',
      );
    });

    it('should skip deposits without transfer sequence', async () => {
      const depositsWithoutSequence = [
        {
          id: 'deposit-without-sequence',
          status: DepositStatus.AWAITING_WORMHOLE_VAA,
          wormholeInfo: {
            txHash: '0xtest-tx-hash',
            transferSequence: null,
            bridgingAttempted: false,
          },
        },
      ] as Deposit[];

      mockDepositStore.getByStatus.mockResolvedValue(depositsWithoutSequence);

      await handler.processWormholeBridging();

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('missing transferSequence'));
    });

    it('should return early if no deposits are awaiting bridging', async () => {
      mockDepositStore.getByStatus.mockResolvedValue([]);

      await handler.processWormholeBridging();

      expect(mockWormhole.getVaa).not.toHaveBeenCalled();
    });
  });

  describe('bridgeSuiDeposit', () => {
    let mockDeposit: Deposit;

    beforeEach(async () => {
      await (handler as any).initializeL2();

      mockDeposit = {
        id: 'test-deposit-id',
        status: DepositStatus.AWAITING_WORMHOLE_VAA,
        wormholeInfo: {
          txHash: '0xtest-tx-hash',
          transferSequence: '123',
          bridgingAttempted: false,
        },
      } as Deposit;
    });

    it('should handle deposit not in correct status', async () => {
      const wrongStatusDeposit = {
        ...mockDeposit,
        status: DepositStatus.INITIALIZED,
      };

      await (handler as any).bridgeSuiDeposit(wrongStatusDeposit);

      expect(mockWormhole.getVaa).not.toHaveBeenCalled();
    });

    it('should warn when missing transfer sequence', async () => {
      const depositWithoutSequence = {
        ...mockDeposit,
        wormholeInfo: {
          txHash: '0xtest-tx-hash',
          transferSequence: null,
          bridgingAttempted: false,
        },
      };

      await (handler as any).bridgeSuiDeposit(depositWithoutSequence);

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No transfer sequence'));
    });

    it('should handle missing VAA gracefully', async () => {
      // Mock fetchVAAFromAPI to return null
      (wormholeVAAModule.fetchVAAFromAPI as jest.Mock).mockResolvedValueOnce(null);

      await (handler as any).bridgeSuiDeposit(mockDeposit);

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('VAA not yet available'));
    });

    it('should successfully bridge deposit to Sui', async () => {
      // Mock fetchVAAFromAPI to return valid base64 VAA
      (wormholeVAAModule.fetchVAAFromAPI as jest.Mock).mockResolvedValueOnce('base64encodedvaa');

      await (handler as any).bridgeSuiDeposit(mockDeposit);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Bridging deposit test-deposit-id on Sui...'),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Successfully submitted VAA to BitcoinDepositor'),
        expect.any(Object),
      );
      expect(mockDepositsUtil.updateToBridgedDeposit).toHaveBeenCalledWith(
        mockDeposit,
        'mock-transaction-digest',
        CHAIN_TYPE.SUI,
      );
    });

    it('should use all required object IDs from configuration', async () => {
      // Mock fetchVAAFromAPI to return valid base64 VAA
      (wormholeVAAModule.fetchVAAFromAPI as jest.Mock).mockResolvedValueOnce('base64encodedvaa');

      await (handler as any).bridgeSuiDeposit(mockDeposit);

      expect(sharedMockTransaction.object).toHaveBeenCalledWith(mockSuiConfig.receiverStateId);
      expect(sharedMockTransaction.object).toHaveBeenCalledWith(mockSuiConfig.gatewayStateId);
      expect(sharedMockTransaction.object).toHaveBeenCalledWith(mockSuiConfig.capabilitiesId);
      expect(sharedMockTransaction.object).toHaveBeenCalledWith(mockSuiConfig.treasuryId);
      expect(sharedMockTransaction.object).toHaveBeenCalledWith(mockSuiConfig.wormholeCoreId);
      expect(sharedMockTransaction.object).toHaveBeenCalledWith(mockSuiConfig.tokenBridgeId);
      expect(sharedMockTransaction.object).toHaveBeenCalledWith(mockSuiConfig.tokenStateId);
      expect(sharedMockTransaction.object).toHaveBeenCalledWith('0x6'); // Clock object
    });

    it('should call receiveWormholeMessages with correct target', async () => {
      // Mock fetchVAAFromAPI to return valid base64 VAA
      (wormholeVAAModule.fetchVAAFromAPI as jest.Mock).mockResolvedValueOnce('base64encodedvaa');

      await (handler as any).bridgeSuiDeposit(mockDeposit);

      expect(sharedMockTransaction.moveCall).toHaveBeenCalledWith(
        expect.objectContaining({
          target: `${mockSuiConfig.l2PackageId}::BitcoinDepositor::receiveWormholeMessages`,
          typeArguments: [mockSuiConfig.wrappedTbtcType],
        }),
      );
    });

    it('should handle transaction failure gracefully', async () => {
      // Mock fetchVAAFromAPI to return valid base64 VAA
      (wormholeVAAModule.fetchVAAFromAPI as jest.Mock).mockResolvedValueOnce('base64encodedvaa');

      // Mock failed transaction (permanent revert -- status 'failure')
      (handler as any).suiClient.signAndExecuteTransaction.mockResolvedValueOnce({
        digest: 'failed-transaction-digest',
        effects: {
          status: { status: 'failure', error: 'Insufficient gas' },
        },
      });

      await (handler as any).bridgeSuiDeposit(mockDeposit);

      // Permanent reverts are logged at error level for operator visibility
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('permanently failed for deposit test-deposit-id'),
        expect.any(Object),
      );
      expect(mockDepositsUtil.updateToBridgedDeposit).not.toHaveBeenCalled();
    });

    it('should handle missing transaction digest', async () => {
      // Mock fetchVAAFromAPI to return valid base64 VAA
      (wormholeVAAModule.fetchVAAFromAPI as jest.Mock).mockResolvedValueOnce('base64encodedvaa');

      // Mock transaction without digest
      (handler as any).suiClient.signAndExecuteTransaction.mockResolvedValueOnce({
        effects: {
          status: { status: 'success' },
        },
      });

      await (handler as any).bridgeSuiDeposit(mockDeposit);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Wormhole bridging failed for deposit test-deposit-id'),
        expect.any(Object),
      );
      expect(mockDepositsUtil.updateToBridgedDeposit).not.toHaveBeenCalled();
    });

    describe('error persistence', () => {
      const FIXED_NOW = 1700000000000;
      let dateNowSpy: jest.SpyInstance;
      let fullMockDeposit: Deposit;

      beforeEach(() => {
        dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);

        fullMockDeposit = {
          id: 'error-persist-deposit-id',
          chainId: 'SuiTestnet',
          status: DepositStatus.AWAITING_WORMHOLE_VAA,
          fundingTxHash: 'mock-funding-tx-hash',
          outputIndex: 1,
          hashes: {
            btc: { btcTxHash: null },
            eth: { initializeTxHash: null, finalizeTxHash: null },
            solana: { bridgeTxHash: null },
            sui: { l2BridgeTxHash: null },
          },
          receipt: {
            depositor: '0x123',
            blindingFactor: '0x456',
            walletPublicKeyHash: '0x789',
            refundPublicKeyHash: '0xabc',
            refundLocktime: '0',
            extraData: '0x',
          },
          owner: 'test-owner',
          L1OutputEvent: {
            fundingTx: {
              version: '01000000',
              inputVector: 'mock_input_vector',
              outputVector: 'mock_output_vector',
              locktime: '00000000',
            },
            reveal: {
              fundingOutputIndex: 1,
              blindingFactor: '0x' + '00'.repeat(32),
              walletPubKeyHash: '0x' + '00'.repeat(20),
              refundPubKeyHash: '0x' + '00'.repeat(20),
              refundLocktime: '0',
              vault: '0x' + '00'.repeat(32),
            },
            l2DepositOwner: '0x0506070800000000000000000000000000000000000000000000000000000000',
            l2Sender: '0x090a0b0c00000000000000000000000000000000000000000000000000000000',
          },
          dates: {
            createdAt: 1699000000000,
            initializationAt: 1699000100000,
            finalizationAt: 1699000200000,
            awaitingWormholeVAAMessageSince: 1699000300000,
            bridgedAt: null,
            lastActivityAt: 1699000300000,
          },
          wormholeInfo: {
            txHash: '0xtest-tx-hash',
            transferSequence: '123',
            bridgingAttempted: false,
          },
          error: null,
        };
      });

      afterEach(() => {
        dateNowSpy.mockRestore();
      });

      it('should tag deposit with receiveTbtc_reverted on permanent transaction revert', async () => {
        (wormholeVAAModule.fetchVAAFromAPI as jest.Mock).mockResolvedValueOnce('base64encodedvaa');

        // Simulate transaction revert: signAndExecuteTransaction returns failure status,
        // causing the inner try-catch to throw "Transaction failed: ..."
        (handler as any).suiClient.signAndExecuteTransaction.mockResolvedValueOnce({
          digest: 'failed-digest',
          effects: {
            status: { status: 'failure', error: 'MoveAbort(0x1, 42)' },
          },
        });

        await (handler as any).bridgeSuiDeposit(fullMockDeposit);

        expect(mockDepositStore.update).toHaveBeenCalledTimes(1);
        const updatedDeposit = mockDepositStore.update.mock.calls[0][0];
        expect(updatedDeposit.error).toBe('receiveTbtc_reverted');
        expect(updatedDeposit.dates.lastActivityAt).toBe(FIXED_NOW);
        expect(updatedDeposit.id).toBe('error-persist-deposit-id');
        expect(mockDepositsUtil.updateToBridgedDeposit).not.toHaveBeenCalled();
      });

      it('should report permanent transaction revert to Sentry', async () => {
        (wormholeVAAModule.fetchVAAFromAPI as jest.Mock).mockResolvedValueOnce('base64encodedvaa');

        (handler as any).suiClient.signAndExecuteTransaction.mockResolvedValueOnce({
          digest: 'failed-digest',
          effects: {
            status: { status: 'failure', error: 'MoveAbort(0x1, 42)' },
          },
        });

        await (handler as any).bridgeSuiDeposit(fullMockDeposit);

        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
        const sentryArgs = (Sentry.captureException as jest.Mock).mock.calls[0];
        expect(sentryArgs[0]).toBeInstanceOf(Error);
        expect(sentryArgs[1]).toEqual(
          expect.objectContaining({
            extra: expect.objectContaining({
              depositId: 'error-persist-deposit-id',
              chainName: 'SuiTestnet',
            }),
          }),
        );
      });

      it('should tag deposit with bridging_exception on transient failure', async () => {
        (wormholeVAAModule.fetchVAAFromAPI as jest.Mock).mockResolvedValueOnce('base64encodedvaa');

        // Simulate transient error: signAndExecuteTransaction rejects with a network error.
        // This does NOT go through the inner try-catch "Transaction failed:" path.
        (handler as any).suiClient.signAndExecuteTransaction.mockRejectedValueOnce(
          new Error('Network timeout'),
        );

        await (handler as any).bridgeSuiDeposit(fullMockDeposit);

        expect(mockDepositStore.update).toHaveBeenCalledTimes(1);
        const updatedDeposit = mockDepositStore.update.mock.calls[0][0];
        expect(updatedDeposit.error).toBe('bridging_exception');
        expect(updatedDeposit.dates.lastActivityAt).toBe(FIXED_NOW);
        expect(Sentry.captureException).not.toHaveBeenCalled();
      });

      it('should preserve all original deposit fields when persisting error', async () => {
        (wormholeVAAModule.fetchVAAFromAPI as jest.Mock).mockResolvedValueOnce('base64encodedvaa');

        (handler as any).suiClient.signAndExecuteTransaction.mockRejectedValueOnce(
          new Error('RPC unavailable'),
        );

        await (handler as any).bridgeSuiDeposit(fullMockDeposit);

        expect(mockDepositStore.update).toHaveBeenCalledTimes(1);
        const updatedDeposit = mockDepositStore.update.mock.calls[0][0];

        // Verify identity and immutable fields are preserved
        expect(updatedDeposit.id).toBe(fullMockDeposit.id);
        expect(updatedDeposit.chainId).toBe(fullMockDeposit.chainId);
        expect(updatedDeposit.status).toBe(fullMockDeposit.status);
        expect(updatedDeposit.fundingTxHash).toBe(fullMockDeposit.fundingTxHash);

        // Verify dates are preserved except lastActivityAt
        expect(updatedDeposit.dates.createdAt).toBe(fullMockDeposit.dates.createdAt);
        expect(updatedDeposit.dates.initializationAt).toBe(fullMockDeposit.dates.initializationAt);
        expect(updatedDeposit.dates.finalizationAt).toBe(fullMockDeposit.dates.finalizationAt);
        expect(updatedDeposit.dates.awaitingWormholeVAAMessageSince).toBe(
          fullMockDeposit.dates.awaitingWormholeVAAMessageSince,
        );

        // Only lastActivityAt and error should differ
        expect(updatedDeposit.dates.lastActivityAt).toBe(FIXED_NOW);
        expect(updatedDeposit.error).toBe('bridging_exception');
      });
    });
  });

  describe('handleSuiDepositEvent', () => {
    beforeEach(async () => {
      await (handler as any).initializeL2();
    });

    it('should process valid SUI deposit event with hex string format', async () => {
      // Mock binary address data (32 bytes each for SUI addresses)
      const mockDepositOwner =
        '0x' + '0506070800000000000000000000000000000000000000000000000000000000';
      const mockSender = '0x' + '090a0b0c00000000000000000000000000000000000000000000000000000000';

      const mockEvent = {
        type: 'DepositInitialized',
        parsedJson: {
          funding_tx: '0x' + '01'.repeat(100),
          deposit_reveal: '0x' + '00'.repeat(56),
          deposit_owner: mockDepositOwner,
          sender: mockSender,
        },
        id: {
          txDigest: 'test-tx-digest',
        },
        checkpoint: 12345,
      };

      // Mock parseDepositInitializedEvent to return parsed data
      const SuiMoveEventParser = require('../../../utils/SuiMoveEventParser.js');
      SuiMoveEventParser.parseDepositInitializedEvent.mockReturnValueOnce({
        fundingTransaction: {
          version: '01000000',
          inputVector: 'mock_input_vector',
          outputVector: 'mock_output_vector',
          locktime: '00000000',
        },
        reveal: {
          fundingOutputIndex: 1,
          blindingFactor: '0x' + '00'.repeat(8),
          walletPubKeyHash: '0x' + 'bb'.repeat(20),
          refundPubKeyHash: '0x' + 'cc'.repeat(20),
          refundLocktime: '0x07a12000',
          vault: '0x' + '00'.repeat(32),
        },
        depositOwner: mockDepositOwner,
        sender: mockSender,
      });

      // Mock DepositStore.getById to return null (no existing deposit)
      mockDepositStore.getById.mockResolvedValueOnce(null);

      await (handler as any).handleSuiDepositEvent(mockEvent);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('SUI deposit successfully created and saved'),
        expect.any(Object),
      );
    });

    it('should process valid SUI deposit event with number array format', async () => {
      // Mock binary address data as number arrays (32 bytes each for SUI addresses)
      const mockDepositOwner = [5, 6, 7, 8, ...Array.from({ length: 28 }, () => 0)]; // 32 bytes
      const mockSender = [9, 10, 11, 12, ...Array.from({ length: 28 }, () => 0)]; // 32 bytes

      const mockEvent = {
        type: 'DepositInitialized',
        parsedJson: {
          funding_tx: Array.from({ length: 100 }, () => 1),
          deposit_reveal: Array.from({ length: 56 }, () => 0),
          deposit_owner: mockDepositOwner,
          sender: mockSender,
        },
        id: {
          txDigest: 'test-tx-digest',
        },
        checkpoint: 12345,
      };

      // Mock parseDepositInitializedEvent to return parsed data
      const SuiMoveEventParser = require('../../../utils/SuiMoveEventParser.js');
      SuiMoveEventParser.parseDepositInitializedEvent.mockReturnValueOnce({
        fundingTransaction: {
          version: '01000000',
          inputVector: 'mock_input_vector',
          outputVector: 'mock_output_vector',
          locktime: '00000000',
        },
        reveal: {
          fundingOutputIndex: 1,
          blindingFactor: '0x' + '00'.repeat(8),
          walletPubKeyHash: '0x' + 'bb'.repeat(20),
          refundPubKeyHash: '0x' + 'cc'.repeat(20),
          refundLocktime: '0x07a12000',
          vault: '0x' + '00'.repeat(32),
        },
        depositOwner: '0x' + mockDepositOwner.map((b) => b.toString(16).padStart(2, '0')).join(''),
        sender: '0x' + mockSender.map((b) => b.toString(16).padStart(2, '0')).join(''),
      });

      // Mock DepositStore.getById to return null (no existing deposit)
      mockDepositStore.getById.mockResolvedValueOnce(null);

      await (handler as any).handleSuiDepositEvent(mockEvent);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('SUI deposit successfully created and saved'),
        expect.any(Object),
      );
    });

    it('should skip events that are not DepositInitialized', async () => {
      const mockEvent = {
        type: 'SomeOtherEvent',
        parsedJson: {},
        id: { txDigest: 'test-tx-digest' },
      };

      await (handler as any).handleSuiDepositEvent(mockEvent);

      expect(logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('SUI deposit successfully created and saved'),
      );
    });

    it('should warn about incomplete event data', async () => {
      const mockEvent = {
        type: 'DepositInitialized',
        parsedJson: {
          funding_tx: '0x' + '01'.repeat(100), // Valid looking hex data
          // Missing required fields
        },
        id: { txDigest: 'test-tx-digest' },
      };

      // Mock parseDepositInitializedEvent to return null (incomplete data)
      const SuiMoveEventParser = require('../../../utils/SuiMoveEventParser.js');
      SuiMoveEventParser.parseDepositInitializedEvent.mockReturnValueOnce(null);

      await (handler as any).handleSuiDepositEvent(mockEvent);

      // When parseDepositInitializedEvent returns null, nothing should be logged
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('SUI deposit successfully created and saved'),
      );
    });

    it('should skip existing deposits', async () => {
      // Mock binary address data for SUI addresses
      const mockDepositOwner =
        '0x' + '0506070800000000000000000000000000000000000000000000000000000000';
      const mockSender = '0x' + '090a0b0c00000000000000000000000000000000000000000000000000000000';

      const mockEvent = {
        type: 'DepositInitialized',
        parsedJson: {
          funding_tx: '0x' + '01'.repeat(100),
          deposit_reveal: '0x' + '00'.repeat(56),
          deposit_owner: mockDepositOwner,
          sender: mockSender,
        },
        id: { txDigest: 'existing-tx-digest' },
      };

      // Mock parseDepositInitializedEvent to return parsed data
      const SuiMoveEventParser = require('../../../utils/SuiMoveEventParser.js');
      SuiMoveEventParser.parseDepositInitializedEvent.mockReturnValueOnce({
        fundingTransaction: {
          version: '01000000',
          inputVector: 'mock_input_vector',
          outputVector: 'mock_output_vector',
          locktime: '00000000',
        },
        reveal: {
          fundingOutputIndex: 1,
          blindingFactor: '0x' + '00'.repeat(8),
          walletPubKeyHash: '0x' + 'bb'.repeat(20),
          refundPubKeyHash: '0x' + 'cc'.repeat(20),
          refundLocktime: '0x07a12000',
          vault: '0x' + '00'.repeat(32),
        },
        depositOwner: mockDepositOwner,
        sender: mockSender,
      });

      mockDepositStore.getById.mockResolvedValueOnce({} as Deposit);

      await (handler as any).handleSuiDepositEvent(mockEvent);

      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('already exists'));
    });

    it('should handle parsing errors gracefully', async () => {
      const mockEvent = {
        type: 'DepositInitialized',
        parsedJson: {
          funding_tx: 'invalid_hex_data',
          deposit_reveal: 'invalid_hex_data',
          deposit_owner: '0x' + '0506070800000000000000000000000000000000000000000000000000000000',
          sender: '0x' + '090a0b0c00000000000000000000000000000000000000000000000000000000',
        },
        id: { txDigest: 'test-tx-digest' },
      };

      // Mock parseDepositInitializedEvent to return null (parsing failed)
      const SuiMoveEventParser = require('../../../utils/SuiMoveEventParser.js');
      SuiMoveEventParser.parseDepositInitializedEvent.mockReturnValueOnce(null);

      await (handler as any).handleSuiDepositEvent(mockEvent);

      // When parseDepositInitializedEvent returns null, nothing should be logged
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('SUI deposit successfully created and saved'),
      );
    });

    it('should handle invalid binary field format', async () => {
      const mockEvent = {
        type: 'DepositInitialized',
        parsedJson: {
          funding_tx: 12345, // Invalid format (not string or array)
          deposit_reveal: '01000000' + '00'.repeat(108),
          deposit_owner: '0x' + '0506070800000000000000000000000000000000000000000000000000000000',
          sender: '0x' + '090a0b0c00000000000000000000000000000000000000000000000000000000',
        },
        id: { txDigest: 'test-tx-digest' },
      };

      // Mock parseDepositInitializedEvent to return null (parsing failed)
      const SuiMoveEventParser = require('../../../utils/SuiMoveEventParser.js');
      SuiMoveEventParser.parseDepositInitializedEvent.mockReturnValueOnce(null);

      await (handler as any).handleSuiDepositEvent(mockEvent);

      // When parseDepositInitializedEvent returns null, nothing should be logged
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('SUI deposit successfully created and saved'),
      );
    });
  });

  describe('Deposit Persistence', () => {
    beforeEach(async () => {
      await (handler as any).initializeL2();
    });

    it('should create and persist deposit to database when processing valid SUI event', async () => {
      // Setup mock data for a valid SUI DepositInitialized event
      const mockDepositOwner =
        '0x' + '0506070800000000000000000000000000000000000000000000000000000000';
      const mockSender = '0x' + '090a0b0c00000000000000000000000000000000000000000000000000000000';

      const mockEvent = {
        type: 'DepositInitialized',
        parsedJson: {
          funding_tx: '0x' + '01'.repeat(100),
          deposit_reveal: '0x' + '00'.repeat(56),
          deposit_owner: mockDepositOwner,
          sender: mockSender,
        },
        id: { txDigest: 'test-tx-digest-for-persistence' },
        checkpoint: 12345,
      };

      // Mock the expected deposit object that createDeposit should return
      const mockCreatedDeposit: Deposit = {
        id: 'test-deposit-id-123',
        chainId: 'SuiTestnet',
        status: DepositStatus.INITIALIZED,
        fundingTxHash: 'mock-funding-tx-hash',
        outputIndex: 1,
        hashes: {
          btc: { btcTxHash: null },
          eth: { initializeTxHash: null, finalizeTxHash: null },
          solana: { bridgeTxHash: null },
          sui: { l2BridgeTxHash: null },
        },
        receipt: {
          depositor: '0x123',
          blindingFactor: '0x456',
          walletPublicKeyHash: '0x789',
          refundPublicKeyHash: '0xabc',
          refundLocktime: '0',
          extraData: '0x',
        },
        owner: 'test-owner',
        L1OutputEvent: {
          fundingTx: {
            version: '01000000',
            inputVector: 'mock_input_vector',
            outputVector: 'mock_output_vector',
            locktime: '00000000',
          },
          reveal: {
            fundingOutputIndex: 1,
            blindingFactor: '0x' + '00'.repeat(32),
            walletPubKeyHash: '0x' + '00'.repeat(20),
            refundPubKeyHash: '0x' + '00'.repeat(20),
            refundLocktime: '0',
            vault: '0x' + '00'.repeat(32),
          },
          l2DepositOwner: '0x0506070800000000000000000000000000000000000000000000000000000000',
          l2Sender: '0x090a0b0c00000000000000000000000000000000000000000000000000000000',
        },
        dates: {
          createdAt: Date.now(),
          initializationAt: null,
          finalizationAt: null,
          awaitingWormholeVAAMessageSince: null,
          bridgedAt: null,
          lastActivityAt: Date.now(),
        },
        wormholeInfo: {
          txHash: null,
          transferSequence: null,
          bridgingAttempted: false,
        },
        error: null,
      };

      // Mock createDeposit to return our test deposit
      mockDepositsUtil.createDeposit.mockReturnValue(mockCreatedDeposit);

      // Mock parseDepositInitializedEvent to return parsed data
      const SuiMoveEventParser = require('../../../utils/SuiMoveEventParser.js');
      SuiMoveEventParser.parseDepositInitializedEvent.mockReturnValueOnce({
        fundingTransaction: {
          version: '01000000',
          inputVector: 'mock_input_vector',
          outputVector: 'mock_output_vector',
          locktime: '00000000',
        },
        reveal: {
          fundingOutputIndex: 1,
          blindingFactor: '0x' + '00'.repeat(8),
          walletPubKeyHash: '0x' + 'bb'.repeat(20),
          refundPubKeyHash: '0x' + 'cc'.repeat(20),
          refundLocktime: '0x07a12000',
          vault: '0x' + '00'.repeat(32),
        },
        depositOwner: mockDepositOwner,
        sender: mockSender,
      });

      // Ensure no existing deposit is found
      mockDepositStore.getById.mockResolvedValue(null);

      // Process the event
      await (handler as any).handleSuiDepositEvent(mockEvent);

      // Verify createDeposit was called with correct parameters
      expect(mockDepositsUtil.createDeposit).toHaveBeenCalledWith(
        expect.objectContaining({
          version: '01000000',
          inputVector: 'mock_input_vector',
          outputVector: 'mock_output_vector',
          locktime: '00000000',
        }),
        expect.objectContaining({
          fundingOutputIndex: 1,
          vault: mockSuiConfig.vaultAddress, // Handler sets vault to config.vaultAddress
        }),
        '0x0506070800000000000000000000000000000000000000000000000000000000', // depositOwner
        '0x090a0b0c00000000000000000000000000000000000000000000000000000000', // sender
        'SuiTestnet', // chainName
      );

      // Verify the deposit was checked for duplicates
      expect(mockDepositStore.getById).toHaveBeenCalledWith('test-deposit-id-123');

      // Verify the deposit was persisted to the database
      expect(mockDepositStore.create).toHaveBeenCalledWith(mockCreatedDeposit);

      // Verify success was logged
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('SUI deposit successfully created and saved: test-deposit-id-123'),
        expect.objectContaining({
          depositOwner: '0x0506070800000000000000000000000000000000000000000000000000000000',
          sender: '0x090a0b0c00000000000000000000000000000000000000000000000000000000',
          fundingOutputIndex: 1,
          chainName: 'SuiTestnet',
          status: DepositStatus.INITIALIZED,
          fundingTxHash: 'mock-funding-tx-hash',
        }),
      );
    });

    it('should not persist deposit if it already exists in database', async () => {
      const mockDepositOwner =
        '0x' + '0506070800000000000000000000000000000000000000000000000000000000';
      const mockSender = '0x' + '090a0b0c00000000000000000000000000000000000000000000000000000000';

      const mockEvent = {
        type: 'DepositInitialized',
        parsedJson: {
          funding_tx: '0x' + '01'.repeat(100),
          deposit_reveal: '0x' + '00'.repeat(56),
          deposit_owner: mockDepositOwner,
          sender: mockSender,
        },
        id: { txDigest: 'existing-tx-digest' },
      };

      const mockCreatedDeposit: Deposit = {
        id: 'existing-deposit-id',
        chainId: 'SuiTestnet',
        status: DepositStatus.INITIALIZED,
        fundingTxHash: 'existing-funding-tx-hash',
        outputIndex: 1,
        hashes: {
          btc: { btcTxHash: null },
          eth: { initializeTxHash: null, finalizeTxHash: null },
          solana: { bridgeTxHash: null },
          sui: { l2BridgeTxHash: null },
        },
        receipt: {
          depositor: '0x123',
          blindingFactor: '0x456',
          walletPublicKeyHash: '0x789',
          refundPublicKeyHash: '0xabc',
          refundLocktime: '0',
          extraData: '0x',
        },
        owner: 'existing-owner',
        L1OutputEvent: {
          fundingTx: {
            version: '01000000',
            inputVector: 'mock_input_vector',
            outputVector: 'mock_output_vector',
            locktime: '00000000',
          },
          reveal: {
            fundingOutputIndex: 1,
            blindingFactor: '0x' + '00'.repeat(32),
            walletPubKeyHash: '0x' + '00'.repeat(20),
            refundPubKeyHash: '0x' + '00'.repeat(20),
            refundLocktime: '0',
            vault: '0x' + '00'.repeat(32),
          },
          l2DepositOwner: '0x0506070800000000000000000000000000000000000000000000000000000000',
          l2Sender: '0x090a0b0c00000000000000000000000000000000000000000000000000000000',
        },
        dates: {
          createdAt: Date.now(),
          initializationAt: null,
          finalizationAt: null,
          awaitingWormholeVAAMessageSince: null,
          bridgedAt: null,
          lastActivityAt: Date.now(),
        },
        wormholeInfo: {
          txHash: null,
          transferSequence: null,
          bridgingAttempted: false,
        },
        error: null,
      };

      // Mock existing deposit found in database
      mockDepositStore.getById.mockResolvedValue(mockCreatedDeposit as Deposit);
      mockDepositsUtil.createDeposit.mockReturnValue(mockCreatedDeposit);

      // Mock parseDepositInitializedEvent to return parsed data
      const SuiMoveEventParser = require('../../../utils/SuiMoveEventParser.js');
      SuiMoveEventParser.parseDepositInitializedEvent.mockReturnValueOnce({
        fundingTransaction: {
          version: '01000000',
          inputVector: 'mock_input_vector',
          outputVector: 'mock_output_vector',
          locktime: '00000000',
        },
        reveal: {
          fundingOutputIndex: 1,
          blindingFactor: '0x' + '00'.repeat(8),
          walletPubKeyHash: '0x' + 'bb'.repeat(20),
          refundPubKeyHash: '0x' + 'cc'.repeat(20),
          refundLocktime: '0x07a12000',
          vault: '0x' + '00'.repeat(32),
        },
        depositOwner: mockDepositOwner,
        sender: mockSender,
      });

      await (handler as any).handleSuiDepositEvent(mockEvent);

      // Verify deposit creation still happened
      expect(mockDepositsUtil.createDeposit).toHaveBeenCalled();

      // Verify duplicate check was performed
      expect(mockDepositStore.getById).toHaveBeenCalledWith('existing-deposit-id');

      // Verify deposit was NOT persisted again
      expect(mockDepositStore.create).not.toHaveBeenCalled();

      // Verify skip message was logged
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('already exists for SuiTestnet. Skipping creation.'),
      );
    });
  });

  describe('searchForTransferSequence', () => {
    let mockDeposit: Deposit;
    let mockFinalizationReceipt: any;
    const FINALIZATION_BLOCK = 1000;
    const MOCK_DEPOSIT_KEY = '12345678901234567890';
    const MOCK_EVENT_TX_HASH = '0xmatching-event-tx-hash';
    const MOCK_TRANSFER_SEQUENCE = '42';
    const TOKENS_TRANSFERRED_TOPIC = ethers.utils.id(
      'TokensTransferredWithPayload(uint256,bytes32,uint64)',
    );

    beforeEach(async () => {
      await (handler as any).initializeL2();

      mockDeposit = {
        id: MOCK_DEPOSIT_KEY,
        chainId: 'SuiTestnet',
        status: DepositStatus.INITIALIZED,
        fundingTxHash: 'mock-funding-tx-hash',
        outputIndex: 1,
        hashes: {
          btc: { btcTxHash: null },
          eth: { initializeTxHash: null, finalizeTxHash: null },
          solana: { bridgeTxHash: null },
          sui: { l2BridgeTxHash: null },
        },
        receipt: {
          depositor: '0x123',
          blindingFactor: '0x456',
          walletPublicKeyHash: '0x789',
          refundPublicKeyHash: '0xabc',
          refundLocktime: '0',
          extraData: '0x',
        },
        owner: 'test-owner',
        L1OutputEvent: {
          fundingTx: {
            version: '01000000',
            inputVector: 'mock_input_vector',
            outputVector: 'mock_output_vector',
            locktime: '00000000',
          },
          reveal: {
            fundingOutputIndex: 1,
            blindingFactor: '0x' + '00'.repeat(32),
            walletPubKeyHash: '0x' + '00'.repeat(20),
            refundPubKeyHash: '0x' + '00'.repeat(20),
            refundLocktime: '0',
            vault: '0x' + '00'.repeat(32),
          },
          l2DepositOwner: '0x0506070800000000000000000000000000000000000000000000000000000000',
          l2Sender: '0x090a0b0c00000000000000000000000000000000000000000000000000000000',
        },
        dates: {
          createdAt: 1699000000000,
          initializationAt: 1699000100000,
          finalizationAt: null,
          awaitingWormholeVAAMessageSince: null,
          bridgedAt: null,
          lastActivityAt: 1699000100000,
        },
        wormholeInfo: {
          txHash: null,
          transferSequence: null,
          bridgingAttempted: false,
        },
        error: null,
      };

      // Receipt from finalization transaction (no TokensTransferredWithPayload)
      mockFinalizationReceipt = {
        transactionHash: '0xfinalize-hash',
        blockNumber: FINALIZATION_BLOCK,
        logs: [],
      };

      // Mock submitFinalizationTx to return receipt without TokensTransferredWithPayload
      (handler as any).submitFinalizationTx = jest.fn().mockResolvedValue(mockFinalizationReceipt);

      // Mock l1BitcoinDepositorProvider with queryFilter, filters, and interface
      (handler as any).l1BitcoinDepositorProvider = {
        queryFilter: jest.fn().mockResolvedValue([]),
        filters: {
          DepositFinalized: jest.fn().mockReturnValue({
            topics: [ethers.utils.id('DepositFinalized(uint256,bytes32,address,uint256,uint256)')],
          }),
        },
        interface: {
          getEventTopic: jest.fn().mockReturnValue(TOKENS_TRANSFERRED_TOPIC),
          parseLog: jest.fn().mockReturnValue({
            name: 'TokensTransferredWithPayload',
            args: {
              transferSequence: ethers.BigNumber.from(MOCK_TRANSFER_SEQUENCE),
            },
          }),
        },
      };

      // Mock l1Provider for fetching event transaction receipts
      (handler as any).l1Provider = {
        getTransactionReceipt: jest.fn().mockResolvedValue({
          transactionHash: MOCK_EVENT_TX_HASH,
          blockNumber: FINALIZATION_BLOCK + 2,
          logs: [
            {
              address: mockSuiConfig.l1BitcoinDepositorAddress,
              topics: [TOKENS_TRANSFERRED_TOPIC],
              data: '0x',
            },
          ],
        }),
      };
    });

    it('should find transferSequence via 5-block immediate window search', async () => {
      // Mock queryFilter to return a matching DepositFinalized event on first call (5-block window)
      const mockEvent = {
        transactionHash: MOCK_EVENT_TX_HASH,
        args: { depositKey: ethers.BigNumber.from(MOCK_DEPOSIT_KEY) },
      };
      (handler as any).l1BitcoinDepositorProvider.queryFilter.mockResolvedValueOnce([mockEvent]);

      // Call finalizeDeposit which should trigger searchForTransferSequence
      await handler.finalizeDeposit(mockDeposit);

      // Verify block-range search found the sequence and updated deposit
      expect(mockDepositsUtil.updateToFinalizedAwaitingVAA).toHaveBeenCalledWith(
        mockDeposit,
        MOCK_EVENT_TX_HASH,
        MOCK_TRANSFER_SEQUENCE,
      );

      // Verify handleMissingTransferSequence was NOT called
      expect(mockDepositsUtil.updateToFinalizedDeposit).not.toHaveBeenCalledWith(
        mockDeposit,
        expect.objectContaining({ hash: expect.any(String) }),
        'transferSequence_not_found',
      );
    });

    it('should widen to 30-block window when 5-block search misses', async () => {
      // First call (5-block window) returns empty
      // Second call (30-block window) returns matching event
      const mockEvent = {
        transactionHash: MOCK_EVENT_TX_HASH,
        args: { depositKey: ethers.BigNumber.from(MOCK_DEPOSIT_KEY) },
      };
      (handler as any).l1BitcoinDepositorProvider.queryFilter
        .mockResolvedValueOnce([]) // 5-block: miss
        .mockResolvedValueOnce([mockEvent]); // 30-block: hit

      await handler.finalizeDeposit(mockDeposit);

      // Verify queryFilter was called twice (5-block then 30-block)
      expect((handler as any).l1BitcoinDepositorProvider.queryFilter).toHaveBeenCalledTimes(2);

      // Verify second call uses wider block range
      const secondCall = (handler as any).l1BitcoinDepositorProvider.queryFilter.mock.calls[1];
      expect(secondCall[1]).toBe(FINALIZATION_BLOCK - 30); // fromBlock
      expect(secondCall[2]).toBe(FINALIZATION_BLOCK + 30); // toBlock

      // Verify deposit was updated with found sequence
      expect(mockDepositsUtil.updateToFinalizedAwaitingVAA).toHaveBeenCalledWith(
        mockDeposit,
        MOCK_EVENT_TX_HASH,
        MOCK_TRANSFER_SEQUENCE,
      );
    });

    it('should fall back to handleMissingTransferSequence when block-range search fails', async () => {
      // Both windows return empty
      (handler as any).l1BitcoinDepositorProvider.queryFilter
        .mockResolvedValueOnce([]) // 5-block: miss
        .mockResolvedValueOnce([]); // 30-block: miss

      await handler.finalizeDeposit(mockDeposit);

      // Verify handleMissingTransferSequence was called (stores with error + Sentry)
      expect(mockDepositsUtil.updateToFinalizedDeposit).toHaveBeenCalledWith(
        mockDeposit,
        { hash: mockFinalizationReceipt.transactionHash },
        'transferSequence_not_found',
      );
      expect(Sentry.captureException).toHaveBeenCalled();

      // Verify updateToFinalizedAwaitingVAA was NOT called
      expect(mockDepositsUtil.updateToFinalizedAwaitingVAA).not.toHaveBeenCalled();
    });

    it('should use depositKey for deterministic correlation (not owner-based matching)', async () => {
      // Return an event so the code path exercises filter creation
      const mockEvent = {
        transactionHash: MOCK_EVENT_TX_HASH,
        args: { depositKey: ethers.BigNumber.from(MOCK_DEPOSIT_KEY) },
      };
      (handler as any).l1BitcoinDepositorProvider.queryFilter.mockResolvedValueOnce([mockEvent]);

      await handler.finalizeDeposit(mockDeposit);

      // Verify DepositFinalized filter was created with the deposit's id (depositKey)
      expect(
        (handler as any).l1BitcoinDepositorProvider.filters.DepositFinalized,
      ).toHaveBeenCalledWith(expect.objectContaining(ethers.BigNumber.from(MOCK_DEPOSIT_KEY)));
    });

    it('should handle L1 provider errors gracefully during block-range search', async () => {
      // queryFilter throws an error
      (handler as any).l1BitcoinDepositorProvider.queryFilter.mockRejectedValueOnce(
        new Error('RPC timeout'),
      );

      await handler.finalizeDeposit(mockDeposit);

      // Verify fallback to handleMissingTransferSequence
      expect(mockDepositsUtil.updateToFinalizedDeposit).toHaveBeenCalledWith(
        mockDeposit,
        { hash: mockFinalizationReceipt.transactionHash },
        'transferSequence_not_found',
      );

      // Verify no unhandled exception (test completes without throwing)
    });

    it('should correctly parse transferSequence from DepositFinalized transaction receipt', async () => {
      // Set up a matching event
      const mockEvent = {
        transactionHash: MOCK_EVENT_TX_HASH,
        args: { depositKey: ethers.BigNumber.from(MOCK_DEPOSIT_KEY) },
      };
      (handler as any).l1BitcoinDepositorProvider.queryFilter.mockResolvedValueOnce([mockEvent]);

      await handler.finalizeDeposit(mockDeposit);

      // Verify l1Provider.getTransactionReceipt was called with the event's tx hash
      expect((handler as any).l1Provider.getTransactionReceipt).toHaveBeenCalledWith(
        MOCK_EVENT_TX_HASH,
      );

      // Verify the sequence was extracted and used to update the deposit
      expect(mockDepositsUtil.updateToFinalizedAwaitingVAA).toHaveBeenCalledWith(
        mockDeposit,
        MOCK_EVENT_TX_HASH,
        MOCK_TRANSFER_SEQUENCE,
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle SUI client initialization errors', async () => {
      const { SuiClient } = require('@mysten/sui/client');
      SuiClient.mockImplementationOnce(() => {
        throw new Error('SUI RPC connection failed');
      });

      await expect((handler as any).initializeL2()).rejects.toThrow('SUI RPC connection failed');
    });

    it('should handle event polling errors gracefully', async () => {
      jest.useFakeTimers();
      await (handler as any).initializeL2();

      const mockError = new Error('Query failed');
      (handler as any).suiClient.queryEvents.mockRejectedValueOnce(mockError);

      // Start polling
      await (handler as any).setupL2Listeners();

      // Trigger the interval
      jest.advanceTimersByTime(5000);

      // Wait for async operations
      await Promise.resolve();

      // Mock logErrorContext to verify it was called
      const logErrorContextModule = await import('../../../utils/Logger.js');
      const logErrorContextSpy = jest.spyOn(logErrorContextModule, 'logErrorContext');

      // Trigger another interval to see the error logged
      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      // Verify error was logged but polling continues
      expect(logErrorContextSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error polling SUI events'),
        mockError,
      );

      logErrorContextSpy.mockRestore();

      // Verify polling interval is still set (not cleared due to error)
      expect((handler as any).pollingInterval).toBeDefined();

      jest.useRealTimers();
    });

    it('should handle queryEvents errors gracefully', async () => {
      await (handler as any).initializeL2();

      const queryError = new Error('Query failed');
      (handler as any).suiClient.queryEvents.mockRejectedValueOnce(queryError);

      // Mock logErrorContext directly since it's the function being called
      const logErrorContextModule = await import('../../../utils/Logger.js');
      const logErrorContextSpy = jest
        .spyOn(logErrorContextModule, 'logErrorContext')
        .mockImplementation();

      await handler.checkForPastDeposits({ pastTimeInMinutes: 60, latestBlock: 12345 });

      expect(logErrorContextSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to check past deposits'),
        queryError,
      );

      logErrorContextSpy.mockRestore();
    });
  });

  describe('recoverStuckFinalizedDeposits', () => {
    const FIXED_NOW = 1700000000000;
    let dateNowSpy: jest.SpyInstance;

    const makeDeposit = (overrides: Partial<Deposit> = {}): Deposit => ({
      id: 'recovery-sui-deposit-id',
      chainId: 'SuiTestnet',
      status: DepositStatus.AWAITING_WORMHOLE_VAA,
      fundingTxHash: 'mock-funding-tx-hash',
      outputIndex: 1,
      hashes: {
        btc: { btcTxHash: null },
        eth: { initializeTxHash: null, finalizeTxHash: null },
        solana: { bridgeTxHash: null },
        sui: { l2BridgeTxHash: null },
      },
      receipt: {
        depositor: '0x123',
        blindingFactor: '0x456',
        walletPublicKeyHash: '0x789',
        refundPublicKeyHash: '0xabc',
        refundLocktime: '0',
        extraData: '0x',
      },
      owner: 'test-owner',
      L1OutputEvent: {
        fundingTx: {
          version: '01000000',
          inputVector: 'mock_input_vector',
          outputVector: 'mock_output_vector',
          locktime: '00000000',
        },
        reveal: {
          fundingOutputIndex: 1,
          blindingFactor: '0x' + '00'.repeat(32),
          walletPubKeyHash: '0x' + '00'.repeat(20),
          refundPubKeyHash: '0x' + '00'.repeat(20),
          refundLocktime: '0',
          vault: '0x' + '00'.repeat(32),
        },
        l2DepositOwner: '0x0506070800000000000000000000000000000000000000000000000000000000',
        l2Sender: '0x090a0b0c00000000000000000000000000000000000000000000000000000000',
      },
      dates: {
        createdAt: 1699000000000,
        initializationAt: 1699000100000,
        finalizationAt: 1699000200000,
        awaitingWormholeVAAMessageSince: FIXED_NOW - RECOVERY_DELAY_MS - 60000,
        bridgedAt: null,
        lastActivityAt: 1699000300000,
      },
      wormholeInfo: {
        txHash: '0xtest-tx-hash',
        transferSequence: '123',
        bridgingAttempted: false,
      },
      error: null,
      ...overrides,
    });

    beforeEach(() => {
      dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    });

    afterEach(() => {
      dateNowSpy.mockRestore();
    });

    it('should re-attempt bridging for stuck deposits older than threshold', async () => {
      const stuckDeposit = makeDeposit();
      mockDepositStore.getByStatus.mockResolvedValueOnce([stuckDeposit]).mockResolvedValueOnce([]);

      const bridgeSpy = jest.spyOn(handler, 'bridgeSuiDeposit' as any).mockResolvedValue(undefined);

      await (handler as any).recoverStuckFinalizedDeposits();

      expect(mockDepositStore.getByStatus).toHaveBeenCalledWith(
        DepositStatus.AWAITING_WORMHOLE_VAA,
        'SuiTestnet',
      );
      expect(bridgeSpy).toHaveBeenCalledTimes(1);
      expect(bridgeSpy).toHaveBeenCalledWith(stuckDeposit);
      bridgeSpy.mockRestore();
    });

    it('should skip deposits tagged with receiveTbtc_reverted', async () => {
      const permanentDeposit = makeDeposit({ error: 'receiveTbtc_reverted' });
      mockDepositStore.getByStatus
        .mockResolvedValueOnce([permanentDeposit])
        .mockResolvedValueOnce([]);

      const bridgeSpy = jest.spyOn(handler, 'bridgeSuiDeposit' as any).mockResolvedValue(undefined);

      await (handler as any).recoverStuckFinalizedDeposits();

      expect(bridgeSpy).not.toHaveBeenCalled();
      bridgeSpy.mockRestore();
    });

    it('should skip deposits not yet older than RECOVERY_DELAY_MS threshold', async () => {
      const recentDeposit = makeDeposit({
        dates: {
          createdAt: 1699000000000,
          initializationAt: 1699000100000,
          finalizationAt: 1699000200000,
          awaitingWormholeVAAMessageSince: FIXED_NOW - 60000,
          bridgedAt: null,
          lastActivityAt: 1699000300000,
        },
      });
      mockDepositStore.getByStatus.mockResolvedValueOnce([recentDeposit]).mockResolvedValueOnce([]);

      const bridgeSpy = jest.spyOn(handler, 'bridgeSuiDeposit' as any).mockResolvedValue(undefined);

      await (handler as any).recoverStuckFinalizedDeposits();

      expect(bridgeSpy).not.toHaveBeenCalled();
      bridgeSpy.mockRestore();
    });

    it('should fall back to finalizationAt when awaitingWormholeVAAMessageSince is null', async () => {
      const fallbackDeposit = makeDeposit({
        dates: {
          createdAt: 1699000000000,
          initializationAt: 1699000100000,
          finalizationAt: FIXED_NOW - RECOVERY_DELAY_MS - 60000,
          awaitingWormholeVAAMessageSince: null,
          bridgedAt: null,
          lastActivityAt: 1699000300000,
        },
      });
      mockDepositStore.getByStatus
        .mockResolvedValueOnce([fallbackDeposit])
        .mockResolvedValueOnce([]);

      const bridgeSpy = jest.spyOn(handler, 'bridgeSuiDeposit' as any).mockResolvedValue(undefined);

      await (handler as any).recoverStuckFinalizedDeposits();

      expect(bridgeSpy).toHaveBeenCalledTimes(1);
      bridgeSpy.mockRestore();
    });

    it('should do nothing when no AWAITING_WORMHOLE_VAA deposits exist', async () => {
      mockDepositStore.getByStatus.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const bridgeSpy = jest.spyOn(handler, 'bridgeSuiDeposit' as any).mockResolvedValue(undefined);

      await (handler as any).recoverStuckFinalizedDeposits();

      expect(bridgeSpy).not.toHaveBeenCalled();
      bridgeSpy.mockRestore();
    });

    it('should handle errors from bridgeSuiDeposit gracefully without throwing', async () => {
      const deposit1 = makeDeposit({ id: 'deposit-1' });
      const deposit2 = makeDeposit({ id: 'deposit-2' });
      mockDepositStore.getByStatus
        .mockResolvedValueOnce([deposit1, deposit2])
        .mockResolvedValueOnce([]);

      const bridgeSpy = jest
        .spyOn(handler, 'bridgeSuiDeposit' as any)
        .mockRejectedValueOnce(new Error('Bridge failed'))
        .mockResolvedValueOnce(undefined);

      await expect((handler as any).recoverStuckFinalizedDeposits()).resolves.toBeUndefined();

      expect(bridgeSpy).toHaveBeenCalledTimes(2);
      bridgeSpy.mockRestore();
    });

    it('should alert on FINALIZED deposits with transferSequence_not_found', async () => {
      const finalizedDeposit = makeDeposit({
        id: 'finalized-stuck-deposit',
        status: DepositStatus.FINALIZED,
        error: 'transferSequence_not_found',
        dates: {
          createdAt: 1699000000000,
          initializationAt: 1699000100000,
          finalizationAt: FIXED_NOW - RECOVERY_DELAY_MS - 60000,
          awaitingWormholeVAAMessageSince: null,
          bridgedAt: null,
          lastActivityAt: 1699000300000,
        },
      });

      mockDepositStore.getByStatus
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([finalizedDeposit]);

      await (handler as any).recoverStuckFinalizedDeposits();

      expect(Sentry.captureException).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('finalized-stuck-deposit'),
        }),
        expect.objectContaining({
          extra: expect.objectContaining({
            depositId: 'finalized-stuck-deposit',
            chainName: 'SuiTestnet',
          }),
        }),
      );

      expect(mockDepositStore.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'finalized-stuck-deposit',
          error: 'transferSequence_not_found_alerted',
        }),
      );
    });
  });
});
