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
  suiGasObjectId: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  l2ContractAddress:
    '0x3d78316ce8ee3fe48d7ff85cdc2d0df9d459f43d802d96f58f7b59984c2dd3ae::bitcoin_depositor',
  // l2WormholeGatewayAddress and l2WormholeChainId removed - not used in Sui chains
  // (replaced by gatewayStateId and native Wormhole SDK integration)

  // Additional required fields for SUI
  wormholeCoreId: '0x5306f64e312b581766351c07af79c72fcb1cd25147157fdc2f8ad76de9a3fb6a',
  tokenBridgeId: '0xc57508ee0d4595e5a8728974a4a93a787d38f339757230d441e895422c07aba9',
  wrappedTbtcType: '0x3d78316ce8ee3fe48d7ff85cdc2d0df9d459f43d802d96f58f7b59984c2dd3ae::tbtc::TBTC',
  receiverStateId: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  gatewayStateId: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde0',
  capabilitiesId: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd01',
  treasuryId: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abc012',
  tokenStateId: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab0123',
});

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

    // Setup default mock implementations
    mockDepositStore.getById = jest.fn().mockResolvedValue(null);
    mockDepositStore.getByStatus = jest.fn().mockResolvedValue([]);
    mockDepositStore.create = jest.fn().mockResolvedValue(undefined);
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
      await (handler as any).setupL2Listeners();

      expect((handler as any).suiClient.subscribeEvent).toHaveBeenCalledWith({
        filter: {
          MoveModule: {
            package: '0x3d78316ce8ee3fe48d7ff85cdc2d0df9d459f43d802d96f58f7b59984c2dd3ae',
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
            package: '0x3d78316ce8ee3fe48d7ff85cdc2d0df9d459f43d802d96f58f7b59984c2dd3ae',
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

    it('should successfully bridge deposit to Sui', async () => {
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
      );
    });

    it('should use all required object IDs from configuration', async () => {
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
      await (handler as any).bridgeSuiDeposit(mockDeposit);

      expect(sharedMockTransaction.moveCall).toHaveBeenCalledWith(
        expect.objectContaining({
          target: `${mockSuiConfig.l2PackageId}::bitcoin_depositor::receiveWormholeMessages`,
          typeArguments: [mockSuiConfig.wrappedTbtcType],
        }),
      );
    });

    it('should handle transaction failure gracefully', async () => {
      // Mock failed transaction
      (handler as any).suiClient.signAndExecuteTransaction.mockResolvedValueOnce({
        digest: 'failed-transaction-digest',
        effects: {
          status: { status: 'failure', error: 'Insufficient gas' },
        },
      });

      await (handler as any).bridgeSuiDeposit(mockDeposit);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Wormhole bridging failed for deposit test-deposit-id'),
        expect.any(Object),
      );
      expect(mockDepositsUtil.updateToBridgedDeposit).not.toHaveBeenCalled();
    });

    it('should handle missing transaction digest', async () => {
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
  });

  describe('handleSuiDepositEvent', () => {
    beforeEach(async () => {
      await (handler as any).initializeL2();
    });

    it('should process valid SUI deposit event with hex string format', async () => {
      // Create valid Bitcoin transaction data (minimal coinbase transaction)
      const createMinimalTransaction = (): number[] => {
        const tx: number[] = [];
        tx.push(0x01, 0x00, 0x00, 0x00); // version 1
        tx.push(0x01); // 1 input
        for (let i = 0; i < 32; i++) tx.push(0x00); // prev tx hash (all zeros for coinbase)
        tx.push(0xff, 0xff, 0xff, 0xff); // output index (0xffffffff for coinbase)
        tx.push(0x00); // script sig length (0 bytes)
        tx.push(0xff, 0xff, 0xff, 0xff); // sequence
        tx.push(0x01); // 1 output
        tx.push(0x00, 0xf2, 0x05, 0x2a, 0x01, 0x00, 0x00, 0x00); // value (5000000000 satoshis)
        tx.push(0x19); // script pubkey length (25 bytes)
        tx.push(0x76, 0xa9, 0x14); // OP_DUP OP_HASH160 <20-byte hash>
        for (let i = 0; i < 20; i++) tx.push(0x00); // 20-byte hash
        tx.push(0x88, 0xac); // OP_EQUALVERIFY OP_CHECKSIG
        tx.push(0x00, 0x00, 0x00, 0x00); // locktime
        return tx;
      };

      // Create valid reveal data (112 bytes total)
      const createValidReveal = (): number[] => {
        const reveal: number[] = [];
        reveal.push(0x01, 0x00, 0x00, 0x00); // funding output index (index 1)
        for (let i = 0; i < 32; i++) reveal.push(0xaa); // blinding factor
        for (let i = 0; i < 20; i++) reveal.push(0xbb); // wallet pubkey hash
        for (let i = 0; i < 20; i++) reveal.push(0xcc); // refund pubkey hash
        reveal.push(0x20, 0xa1, 0x07, 0x00); // refund locktime (500000)
        for (let i = 0; i < 32; i++) reveal.push(0xdd); // vault
        return reveal;
      };

      // Convert to hex strings for this test
      const mockFundingTx = '0x' + Buffer.from(createMinimalTransaction()).toString('hex');
      const mockReveal = '0x' + Buffer.from(createValidReveal()).toString('hex');
      // Mock binary address data (32 bytes each for SUI addresses)
      const mockDepositOwner =
        '0x' + '0506070800000000000000000000000000000000000000000000000000000000';
      const mockSender = '0x' + '090a0b0c00000000000000000000000000000000000000000000000000000000';

      const mockEvent = {
        type: 'DepositInitialized',
        parsedJson: {
          funding_tx: mockFundingTx,
          deposit_reveal: mockReveal,
          deposit_owner: mockDepositOwner,
          sender: mockSender,
        },
        id: {
          txDigest: 'test-tx-digest',
        },
        checkpoint: 12345,
      };

      // Mock DepositStore.getById to return null (no existing deposit)
      mockDepositStore.getById.mockResolvedValueOnce(null);

      await (handler as any).handleSuiDepositEvent(mockEvent);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('SUI deposit successfully created and saved'),
        expect.any(Object),
      );
    });

    it('should process valid SUI deposit event with number array format', async () => {
      // Create valid Bitcoin transaction data (minimal coinbase transaction)
      const createMinimalTransaction = (): number[] => {
        const tx: number[] = [];
        tx.push(0x01, 0x00, 0x00, 0x00); // version 1
        tx.push(0x01); // 1 input
        for (let i = 0; i < 32; i++) tx.push(0x00); // prev tx hash (all zeros for coinbase)
        tx.push(0xff, 0xff, 0xff, 0xff); // output index (0xffffffff for coinbase)
        tx.push(0x00); // script sig length (0 bytes)
        tx.push(0xff, 0xff, 0xff, 0xff); // sequence
        tx.push(0x01); // 1 output
        tx.push(0x00, 0xf2, 0x05, 0x2a, 0x01, 0x00, 0x00, 0x00); // value (5000000000 satoshis)
        tx.push(0x19); // script pubkey length (25 bytes)
        tx.push(0x76, 0xa9, 0x14); // OP_DUP OP_HASH160 <20-byte hash>
        for (let i = 0; i < 20; i++) tx.push(0x00); // 20-byte hash
        tx.push(0x88, 0xac); // OP_EQUALVERIFY OP_CHECKSIG
        tx.push(0x00, 0x00, 0x00, 0x00); // locktime
        return tx;
      };

      // Create valid reveal data (112 bytes total)
      const createValidReveal = (): number[] => {
        const reveal: number[] = [];
        reveal.push(0x01, 0x00, 0x00, 0x00); // funding output index (index 1)
        for (let i = 0; i < 32; i++) reveal.push(0xaa); // blinding factor
        for (let i = 0; i < 20; i++) reveal.push(0xbb); // wallet pubkey hash
        for (let i = 0; i < 20; i++) reveal.push(0xcc); // refund pubkey hash
        reveal.push(0x20, 0xa1, 0x07, 0x00); // refund locktime (500000)
        for (let i = 0; i < 32; i++) reveal.push(0xdd); // vault
        return reveal;
      };

      // Use number arrays directly for this test
      const mockFundingTx = createMinimalTransaction();
      const mockReveal = createValidReveal();
      // Mock binary address data as number arrays (32 bytes each for SUI addresses)
      const mockDepositOwner = [5, 6, 7, 8, ...Array(28).fill(0)]; // 32 bytes
      const mockSender = [9, 10, 11, 12, ...Array(28).fill(0)]; // 32 bytes

      const mockEvent = {
        type: 'DepositInitialized',
        parsedJson: {
          funding_tx: mockFundingTx,
          deposit_reveal: mockReveal,
          deposit_owner: mockDepositOwner,
          sender: mockSender,
        },
        id: {
          txDigest: 'test-tx-digest',
        },
        checkpoint: 12345,
      };

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

      await (handler as any).handleSuiDepositEvent(mockEvent);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Incomplete SUI deposit event data'),
        expect.any(Object),
      );
    });

    it('should skip existing deposits', async () => {
      // Create valid Bitcoin transaction data (minimal coinbase transaction)
      const createMinimalTransaction = (): number[] => {
        const tx: number[] = [];
        tx.push(0x01, 0x00, 0x00, 0x00); // version 1
        tx.push(0x01); // 1 input
        for (let i = 0; i < 32; i++) tx.push(0x00); // prev tx hash (all zeros for coinbase)
        tx.push(0xff, 0xff, 0xff, 0xff); // output index (0xffffffff for coinbase)
        tx.push(0x00); // script sig length (0 bytes)
        tx.push(0xff, 0xff, 0xff, 0xff); // sequence
        tx.push(0x01); // 1 output
        tx.push(0x00, 0xf2, 0x05, 0x2a, 0x01, 0x00, 0x00, 0x00); // value (5000000000 satoshis)
        tx.push(0x19); // script pubkey length (25 bytes)
        tx.push(0x76, 0xa9, 0x14); // OP_DUP OP_HASH160 <20-byte hash>
        for (let i = 0; i < 20; i++) tx.push(0x00); // 20-byte hash
        tx.push(0x88, 0xac); // OP_EQUALVERIFY OP_CHECKSIG
        tx.push(0x00, 0x00, 0x00, 0x00); // locktime
        return tx;
      };

      // Create valid reveal data (112 bytes total)
      const createValidReveal = (): number[] => {
        const reveal: number[] = [];
        reveal.push(0x01, 0x00, 0x00, 0x00); // funding output index (index 1)
        for (let i = 0; i < 32; i++) reveal.push(0xaa); // blinding factor
        for (let i = 0; i < 20; i++) reveal.push(0xbb); // wallet pubkey hash
        for (let i = 0; i < 20; i++) reveal.push(0xcc); // refund pubkey hash
        reveal.push(0x20, 0xa1, 0x07, 0x00); // refund locktime (500000)
        for (let i = 0; i < 32; i++) reveal.push(0xdd); // vault
        return reveal;
      };

      const mockFundingTx = '0x' + Buffer.from(createMinimalTransaction()).toString('hex');
      const mockReveal = '0x' + Buffer.from(createValidReveal()).toString('hex');
      // Mock binary address data for SUI addresses
      const mockDepositOwner =
        '0x' + '0506070800000000000000000000000000000000000000000000000000000000';
      const mockSender = '0x' + '090a0b0c00000000000000000000000000000000000000000000000000000000';

      const mockEvent = {
        type: 'DepositInitialized',
        parsedJson: {
          funding_tx: mockFundingTx,
          deposit_reveal: mockReveal,
          deposit_owner: mockDepositOwner,
          sender: mockSender,
        },
        id: { txDigest: 'existing-tx-digest' },
      };

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

      await (handler as any).handleSuiDepositEvent(mockEvent);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse Bitcoin data from SUI event for SuiTestnet:'),
        expect.objectContaining({
          error: expect.any(String),
          eventType: 'DepositInitialized',
          txDigest: 'test-tx-digest',
        }),
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

      await (handler as any).handleSuiDepositEvent(mockEvent);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse Bitcoin data from SUI event for SuiTestnet:'),
        expect.objectContaining({
          error: expect.any(String),
          eventType: 'DepositInitialized',
          txDigest: 'test-tx-digest',
        }),
      );
    });
  });

  describe('Deposit Persistence', () => {
    beforeEach(async () => {
      await (handler as any).initializeL2();
    });

    it('should create and persist deposit to database when processing valid SUI event', async () => {
      // Setup mock data for a valid SUI DepositInitialized event
      const mockFundingTx = [1, 0, 0, 0, 1, ...Array(100).fill(0)]; // Valid binary data
      const mockReveal = [1, 0, 0, 0, ...Array(108).fill(0)]; // Valid binary data
      const mockDepositOwner = [5, 6, 7, 8, ...Array(28).fill(0)]; // 32 bytes for SUI address
      const mockSender = [9, 10, 11, 12, ...Array(28).fill(0)]; // 32 bytes for SUI address

      const mockEvent = {
        type: 'DepositInitialized',
        parsedJson: {
          funding_tx: mockFundingTx,
          deposit_reveal: mockReveal,
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

      // Mock Bitcoin parser functions to return valid data
      const mockParseFundingTransaction = jest.spyOn(
        require('../../../utils/BitcoinTransactionParser.js'),
        'parseFundingTransaction',
      );
      const mockParseReveal = jest.spyOn(
        require('../../../utils/BitcoinTransactionParser.js'),
        'parseReveal',
      );

      mockParseFundingTransaction.mockReturnValue({
        version: '01000000',
        inputVector: 'mock_input_vector',
        outputVector: 'mock_output_vector',
        locktime: '00000000',
      });

      mockParseReveal.mockReturnValue({
        fundingOutputIndex: 1,
        blindingFactor: '0x' + '00'.repeat(32),
        walletPubKeyHash: '0x' + '00'.repeat(20),
        refundPubKeyHash: '0x' + '00'.repeat(20),
        refundLocktime: '0',
        vault: '0x' + '00'.repeat(32),
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
          vault: '0x' + '00'.repeat(32),
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

      // Cleanup mocks
      mockParseFundingTransaction.mockRestore();
      mockParseReveal.mockRestore();
    });

    it('should not persist deposit if it already exists in database', async () => {
      const mockFundingTx = [1, 0, 0, 0, 1, ...Array(100).fill(0)];
      const mockReveal = [1, 0, 0, 0, ...Array(108).fill(0)];
      const mockDepositOwner = [5, 6, 7, 8, ...Array(28).fill(0)];
      const mockSender = [9, 10, 11, 12, ...Array(28).fill(0)];

      const mockEvent = {
        type: 'DepositInitialized',
        parsedJson: {
          funding_tx: mockFundingTx,
          deposit_reveal: mockReveal,
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

      // Mock Bitcoin parser functions
      const mockParseFundingTransaction = jest.spyOn(
        require('../../../utils/BitcoinTransactionParser.js'),
        'parseFundingTransaction',
      );
      const mockParseReveal = jest.spyOn(
        require('../../../utils/BitcoinTransactionParser.js'),
        'parseReveal',
      );

      mockParseFundingTransaction.mockReturnValue({
        version: '01000000',
        inputVector: 'mock_input_vector',
        outputVector: 'mock_output_vector',
        locktime: '00000000',
      });

      mockParseReveal.mockReturnValue({
        fundingOutputIndex: 1,
        blindingFactor: '0x' + '00'.repeat(32),
        walletPubKeyHash: '0x' + '00'.repeat(20),
        refundPubKeyHash: '0x' + '00'.repeat(20),
        refundLocktime: '0',
        vault: '0x' + '00'.repeat(32),
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

      // Cleanup mocks
      mockParseFundingTransaction.mockRestore();
      mockParseReveal.mockRestore();
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
