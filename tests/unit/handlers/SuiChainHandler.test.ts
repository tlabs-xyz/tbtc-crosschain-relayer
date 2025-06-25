import { SuiChainHandler } from '../../../handlers/SuiChainHandler.js';
import {
  SuiChainConfigSchema,
  type SuiChainConfig,
} from '../../../config/schemas/sui.chain.schema.js';
import { CHAIN_TYPE, NETWORK } from '../../../config/schemas/common.schema.js';
import { DepositStore } from '../../../utils/DepositStore.js';
import logger from '../../../utils/Logger.js';
import { DepositStatus } from '../../../types/DepositStatus.enum.js';
import type { Deposit } from '../../../types/Deposit.type.js';
import * as depositUtils from '../../../utils/Deposits.js';
import * as auditLog from '../../../utils/AuditLog.js';
import { ethers } from 'ethers';

// Mock external dependencies
jest.mock('../../../utils/DepositStore');
jest.mock('../../../utils/Logger');
jest.mock('../../../utils/Deposits');
jest.mock('../../../utils/AuditLog');

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
  const mockKeypair = {
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

jest.mock('@mysten/sui/transactions', () => {
  const mockTransaction = {
    moveCall: jest.fn(),
    setGasPayment: jest.fn(),
    object: jest.fn(),
    pure: jest.fn(),
  };

  return {
    Transaction: jest.fn().mockImplementation(() => mockTransaction),
    __esModule: true,
  };
});

jest.mock('@mysten/bcs', () => ({
  fromBase64: jest.fn().mockReturnValue(new Uint8Array(32)),
  __esModule: true,
}));

// Mock the config module to prevent loading all chain configurations during unit tests
jest.mock('../../../config/index.js', () => ({
  chainConfigs: {},
  getAvailableChainKeys: () => ['suiTestnet'],
}));

// Mock Wormhole SDK
jest.mock('@wormhole-foundation/sdk', () => ({
  signSendWait: jest.fn(),
  Wormhole: {
    parseAddress: jest.fn().mockReturnValue('mock-address'),
  },
}));

// Default config for tests
const mockSuiConfig: SuiChainConfig = SuiChainConfigSchema.parse({
  // CommonChainConfigSchema fields
  chainName: 'SuiTestnet',
  network: NETWORK.TESTNET,
  l1ChainName: 'SepoliaTestnet',
  l1Confirmations: 3,
  l1Rpc: 'http://l1-rpc.test',
  l2Rpc: 'https://fullnode.testnet.sui.io',
  l2WsRpc: 'wss://fullnode.testnet.sui.io',
  l1ContractAddress: '0x1234567890123456789012345678901234567890',
  vaultAddress: '0xabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcde',
  l1StartBlock: 1,
  l2StartBlock: 0,
  enableL2Redemption: false,
  useEndpoint: false,

  // SuiChainBaseSchema fields
  chainType: CHAIN_TYPE.SUI,
  suiPrivateKey: 'dGVzdC1zdWktcHJpdmF0ZS1rZXktZm9yLXRlc3Rpbmc=', // base64 encoded test key (longer)
  suiGasObjectId: '0x123456789abcdef',
  l2ContractAddress:
    '0x1db1fcdaada7c286d77f3347e593e06d8f33b8255e0861033a0a9f321f4eade7::bitcoin_depositor',
  l2WormholeGatewayAddress: '0xc57508ee0d4595e5a8728974a4a93a787d38f339757230d441e895422c07aba9',
  l2WormholeChainId: 21,
});

describe('SuiChainHandler', () => {
  let handler: SuiChainHandler;
  let mockDepositStore: jest.Mocked<typeof DepositStore>;
  let mockDepositsUtil: jest.Mocked<typeof depositUtils>;

  // Mock wormhole object
  const mockWormhole = {
    getChain: jest.fn().mockReturnValue({
      getTBTCBridge: jest.fn().mockResolvedValue({
        redeem: jest.fn().mockReturnValue([]),
      }),
      parseTransaction: jest.fn().mockResolvedValue([
        {
          chain: 'Ethereum',
          emitter: '0x123',
          sequence: BigInt(1),
        },
      ]),
    }),
    getVaa: jest.fn().mockResolvedValue({
      binary: new Uint8Array([1, 2, 3, 4]),
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mocked modules
    mockDepositStore = DepositStore as jest.Mocked<typeof DepositStore>;
    mockDepositsUtil = depositUtils as jest.Mocked<typeof depositUtils>;

    // Setup default mock implementations
    mockDepositStore.getById = jest.fn().mockResolvedValue(null);
    mockDepositStore.getByStatus = jest.fn().mockResolvedValue([]);
    (mockDepositsUtil as any).updateToAwaitingWormholeVAA = jest.fn().mockResolvedValue(undefined);
    (mockDepositsUtil as any).updateToBridgedDeposit = jest.fn().mockResolvedValue(undefined);

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
      delete (configWithoutL2Rpc as any).l2Rpc;
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
      await (handler as any).setupL2Listeners();

      expect((handler as any).suiClient.subscribeEvent).toHaveBeenCalledWith({
        filter: {
          MoveModule: {
            package: '0x1db1fcdaada7c286d77f3347e593e06d8f33b8255e0861033a0a9f321f4eade7',
            module: 'bitcoin_depositor',
          },
        },
        onMessage: expect.any(Function),
      });
    });

    it('should skip listeners when using endpoint', async () => {
      const endpointConfig = { ...mockSuiConfig, useEndpoint: true };
      const endpointHandler = new SuiChainHandler(endpointConfig);

      // Mock the wormhole property before initializeL2
      (endpointHandler as any).wormhole = mockWormhole;

      await (endpointHandler as any).initializeL2();

      await (endpointHandler as any).setupL2Listeners();

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Sui L2 Listeners skipped'),
      );
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
            package: '0x1db1fcdaada7c286d77f3347e593e06d8f33b8255e0861033a0a9f321f4eade7',
            module: 'bitcoin_depositor',
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
      delete (noRpcConfig as any).l2Rpc;
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
            topics: [ethers.utils.id('TokensTransferredWithPayload(uint256,bytes32,uint64)')],
          },
        ],
      };

      // Mock the parent finalizeDeposit call
      jest
        .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(handler)), 'finalizeDeposit')
        .mockResolvedValue(mockReceipt);

      // Mock the l1BitcoinDepositor interface
      (handler as any).l1BitcoinDepositor = {
        interface: {
          parseLog: jest.fn().mockReturnValue({
            args: { transferSequence: ethers.BigNumber.from(123) },
          }),
        },
      };
    });

    it('should process finalization and update to awaiting Wormhole VAA', async () => {
      const result = await handler.finalizeDeposit(mockDeposit);

      expect(result).toBe(mockReceipt);
      expect(mockDepositsUtil.updateToAwaitingWormholeVAA).toHaveBeenCalledWith(
        '0xtest-finalize-hash',
        mockDeposit,
        '123',
      );
    });

    it('should return early if base finalization fails', async () => {
      jest
        .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(handler)), 'finalizeDeposit')
        .mockResolvedValueOnce(undefined);

      const result = await handler.finalizeDeposit(mockDeposit);

      expect(result).toBeUndefined();
      expect(mockDepositsUtil.updateToAwaitingWormholeVAA).not.toHaveBeenCalled();
    });

    it('should handle missing transfer sequence gracefully', async () => {
      const receiptWithoutTransferSequence = {
        ...mockReceipt,
        logs: [],
      };

      jest
        .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(handler)), 'finalizeDeposit')
        .mockResolvedValueOnce(receiptWithoutTransferSequence);

      const result = await handler.finalizeDeposit(mockDeposit);

      expect(result).toBe(receiptWithoutTransferSequence);
      expect(mockDepositsUtil.updateToAwaitingWormholeVAA).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not find transferSequence'),
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

    it('should handle missing Wormhole message', async () => {
      mockWormhole.getChain().parseTransaction.mockResolvedValueOnce([]);

      await (handler as any).bridgeSuiDeposit(mockDeposit);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No Wormhole message found'),
      );
    });

    it('should handle unsigned VAA gracefully', async () => {
      mockWormhole.getVaa.mockResolvedValueOnce(null);

      await (handler as any).bridgeSuiDeposit(mockDeposit);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('VAA message is not yet signed'),
      );
    });

    it('should log successful bridging setup', async () => {
      await (handler as any).bridgeSuiDeposit(mockDeposit);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          'Wormhole bridge integration for Sui requires further SDK integration',
        ),
      );
    });
  });

  describe('handleSuiDepositEvent', () => {
    beforeEach(async () => {
      await (handler as any).initializeL2();
    });

    it('should process valid SUI deposit event', async () => {
      const mockEvent = {
        type: 'DepositInitialized',
        parsedJson: {
          deposit_key: 'test-deposit-key',
          funding_tx_hash: '0xtest-funding-hash',
          output_index: 1,
          depositor: '0xtest-depositor',
        },
        id: {
          txDigest: 'test-tx-digest',
        },
        checkpoint: 12345,
      };

      await (handler as any).handleSuiDepositEvent(mockEvent);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('SUI deposit event received'),
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
        expect.stringContaining('SUI deposit event received'),
      );
    });

    it('should warn about incomplete event data', async () => {
      const mockEvent = {
        type: 'DepositInitialized',
        parsedJson: {
          deposit_key: 'test-deposit-key',
          // Missing required fields
        },
        id: { txDigest: 'test-tx-digest' },
      };

      await (handler as any).handleSuiDepositEvent(mockEvent);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Incomplete SUI deposit event data'),
      );
    });

    it('should skip existing deposits', async () => {
      const mockEvent = {
        type: 'DepositInitialized',
        parsedJson: {
          deposit_key: 'existing-deposit-key',
          funding_tx_hash: '0xtest-funding-hash',
          output_index: 1,
          depositor: '0xtest-depositor',
        },
        id: { txDigest: 'test-tx-digest' },
      };

      mockDepositStore.getById.mockResolvedValueOnce({} as Deposit);

      await (handler as any).handleSuiDepositEvent(mockEvent);

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Deposit existing-deposit-key already exists'),
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

    it('should handle event subscription errors', async () => {
      await (handler as any).initializeL2();

      const mockError = new Error('Event subscription failed');
      (handler as any).suiClient.subscribeEvent.mockRejectedValueOnce(mockError);

      await expect((handler as any).setupL2Listeners()).rejects.toThrow(
        'Event subscription failed',
      );
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
});
