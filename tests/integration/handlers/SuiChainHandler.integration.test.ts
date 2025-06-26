// Mock problematic modules first to prevent deep loading
jest.mock('@wormhole-foundation/sdk', () => ({
  wormhole: jest.fn(),
  Wormhole: {
    parseAddress: jest.fn().mockReturnValue('mock-address'),
  },
  signSendWait: jest.fn(),
  __esModule: true,
}));

jest.mock('@wormhole-foundation/sdk-sui', () => ({
  getSuiSigner: jest.fn().mockResolvedValue({
    chain: jest.fn().mockReturnValue('Sui'),
    address: jest.fn().mockReturnValue('0xsuiaddress'),
  }),
  __esModule: true,
}));

import { SuiChainHandler } from '../../../handlers/SuiChainHandler.js';
import {
  SuiChainConfigSchema,
  type SuiChainConfig,
} from '../../../config/schemas/sui.chain.schema.js';
import { CHAIN_TYPE, NETWORK } from '../../../config/schemas/common.schema.js';
import { DepositStore } from '../../../utils/DepositStore.js';
import { DepositStatus } from '../../../types/DepositStatus.enum.js';
import type { Deposit } from '../../../types/Deposit.type.js';
import { createTestDeposit } from '../../mocks/BlockchainMock.js';

// Mock SUI SDK for integration tests with enhanced ESM support
jest.mock('@mysten/sui/client', () => ({
  SuiClient: jest.fn(),
  getFullnodeUrl: jest.fn().mockReturnValue('https://fullnode.testnet.sui.io'),
  __esModule: true,
}));

jest.mock('@mysten/sui/keypairs/ed25519', () => ({
  Ed25519Keypair: {
    fromSecretKey: jest.fn(),
  },
  __esModule: true,
}));

jest.mock('@mysten/sui/transactions', () => ({
  Transaction: jest.fn(),
  __esModule: true,
}));

// Mock @mysten/bcs to prevent deep loading and transform errors
jest.mock('@mysten/bcs', () => ({
  fromBase64: jest.fn().mockReturnValue(new Uint8Array(32)),
  toBase64: jest.fn().mockReturnValue('base64-string'),
  BCS: jest.fn(),
  bcs: {
    bytes: jest.fn().mockReturnValue({
      serialize: jest.fn(),
      deserialize: jest.fn(),
      transform: jest.fn(),
    }),
    string: jest.fn().mockReturnValue({
      serialize: jest.fn(),
      deserialize: jest.fn(),
      transform: jest.fn(),
    }),
    u8: jest.fn().mockReturnValue({
      serialize: jest.fn(),
      deserialize: jest.fn(),
      transform: jest.fn(),
    }),
    u64: jest.fn().mockReturnValue({
      serialize: jest.fn(),
      deserialize: jest.fn(),
      transform: jest.fn(),
    }),
  },
  __esModule: true,
}));

// Mock the config module
jest.mock('../../../config/index.js', () => ({
  chainConfigs: {},
  getAvailableChainKeys: () => ['suiTestnet'],
}));

// Mock the Deposits utility module
jest.mock('../../../utils/Deposits.js', () => ({
  updateToAwaitingWormholeVAA: jest.fn().mockResolvedValue(undefined),
  updateToBridgedDeposit: jest.fn().mockResolvedValue(undefined),
}));

describe('SuiChainHandler Integration Tests', () => {
  let handler: SuiChainHandler;
  let mockConfig: SuiChainConfig;

  beforeAll(() => {
    // Setup test configuration
    mockConfig = SuiChainConfigSchema.parse({
      chainName: 'SuiTestnet',
      network: NETWORK.TESTNET,
      l1ChainName: 'SepoliaTestnet',
      l1Confirmations: 3,
      l1Rpc: 'http://localhost:8545',
      l2Rpc: 'https://fullnode.testnet.sui.io',
      l2WsRpc: 'wss://fullnode.testnet.sui.io',
      l1ContractAddress: '0x1234567890123456789012345678901234567890',
      vaultAddress: '0xabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcde',
      l1StartBlock: 1,
      l2StartBlock: 0,
      enableL2Redemption: false,
      useEndpoint: false,
      chainType: CHAIN_TYPE.SUI,
      suiPrivateKey: 'dGVzdC1zdWktcHJpdmF0ZS1rZXktZm9yLXRlc3Rpbmc=',
      suiGasObjectId: '0x123456789abcdef',
      l2ContractAddress:
        '0x1db1fcdaada7c286d77f3347e593e06d8f33b8255e0861033a0a9f321f4eade7::bitcoin_depositor',
      l2WormholeGatewayAddress:
        '0xc57508ee0d4595e5a8728974a4a93a787d38f339757230d441e895422c07aba9',
      l2WormholeChainId: 21,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new SuiChainHandler(mockConfig);

    // Mock the wormhole property for integration tests
    (handler as any).wormhole = {
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
  });

  describe('Chain Handler Lifecycle', () => {
    it('should initialize and setup listeners successfully', async () => {
      // Mock SUI client methods
      const mockSuiClient = {
        getLatestCheckpointSequenceNumber: jest.fn().mockResolvedValue('12345'),
        subscribeEvent: jest.fn().mockResolvedValue(() => jest.fn()),
        queryEvents: jest.fn().mockResolvedValue({
          data: [],
          hasNextPage: false,
          nextCursor: null,
        }),
      };

      const { SuiClient } = require('@mysten/sui/client');
      SuiClient.mockImplementation(() => mockSuiClient);

      const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
      Ed25519Keypair.fromSecretKey.mockReturnValue({
        publicKey: jest.fn().mockReturnValue('mock-public-key'),
      });

      // Initialize L2 components
      await (handler as any).initializeL2();

      // Verify SUI client was created
      expect((handler as any).suiClient).toBeDefined();
      expect((handler as any).keypair).toBeDefined();

      // Setup listeners
      await (handler as any).setupL2Listeners();

      // Verify event subscription was called
      expect(mockSuiClient.subscribeEvent).toHaveBeenCalledWith({
        filter: {
          MoveModule: {
            package: '0x1db1fcdaada7c286d77f3347e593e06d8f33b8255e0861033a0a9f321f4eade7',
            module: 'bitcoin_depositor',
          },
        },
        onMessage: expect.any(Function),
      });
    });

    it('should handle checkpoint-based block management', async () => {
      const mockSuiClient = {
        getLatestCheckpointSequenceNumber: jest.fn().mockResolvedValue('54321'),
      };

      const { SuiClient } = require('@mysten/sui/client');
      SuiClient.mockImplementation(() => mockSuiClient);

      await (handler as any).initializeL2();

      const latestBlock = await handler.getLatestBlock();

      expect(latestBlock).toBe(54321);
      expect(mockSuiClient.getLatestCheckpointSequenceNumber).toHaveBeenCalled();
    });

    it('should support past deposit checking when properly configured', () => {
      expect(handler.supportsPastDepositCheck()).toBe(true);

      const endpointConfig = { ...mockConfig, useEndpoint: true };
      const endpointHandler = new SuiChainHandler(endpointConfig);
      expect(endpointHandler.supportsPastDepositCheck()).toBe(false);

      const noRpcConfig = { ...mockConfig };
      (noRpcConfig as any).l2Rpc = undefined;
      const noRpcHandler = new SuiChainHandler(noRpcConfig as any);
      expect(noRpcHandler.supportsPastDepositCheck()).toBe(false);
    });
  });

  describe('Deposit Processing Integration', () => {
    let testDeposit: Deposit;

    beforeEach(() => {
      testDeposit = createTestDeposit({
        status: DepositStatus.AWAITING_WORMHOLE_VAA,
        chainId: 'SuiTestnet',
        wormholeInfo: {
          txHash: '0xtest-tx-hash',
          transferSequence: '123',
          bridgingAttempted: false,
        },
      }) as Deposit;
    });

    it('should process Wormhole bridging workflow', async () => {
      // Mock DepositStore
      jest.spyOn(DepositStore, 'getByStatus').mockResolvedValue([testDeposit]);

      // Mock SUI client setup
      const mockSuiClient = {
        signAndExecuteTransaction: jest.fn().mockResolvedValue({
          digest: 'mock-transaction-digest',
          effects: { status: { status: 'success' } },
        }),
      };

      const { SuiClient } = require('@mysten/sui/client');
      SuiClient.mockImplementation(() => mockSuiClient);

      const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
      Ed25519Keypair.fromSecretKey.mockReturnValue({
        publicKey: jest.fn().mockReturnValue('mock-public-key'),
      });

      await (handler as any).initializeL2();

      // Process Wormhole bridging
      await handler.processWormholeBridging();

      // Verify DepositStore was queried for awaiting deposits
      expect(DepositStore.getByStatus).toHaveBeenCalledWith(
        DepositStatus.AWAITING_WORMHOLE_VAA,
        'SuiTestnet',
      );

      // Verify Wormhole context was used
      expect((handler as any).wormhole.getChain).toHaveBeenCalledWith('Ethereum');
    });

    it('should handle deposit finalization with Wormhole sequence extraction', async () => {
      // Import ethers to get the correct topic signature
      const ethers = require('ethers');
      const TOKENS_TRANSFERRED_SIG = ethers.utils.id(
        'TokensTransferredWithPayload(uint256,bytes32,uint64)',
      );

      // Mock parent finalizeDeposit
      const mockReceipt = {
        transactionHash: '0xfinalize-hash',
        logs: [
          {
            topics: [TOKENS_TRANSFERRED_SIG], // Use the correct topic signature
            data: '0x' + '0'.repeat(128), // Mock log data
          },
        ],
      };

      jest
        .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(handler)), 'finalizeDeposit')
        .mockResolvedValue(mockReceipt);

      // Mock L1 contract interface - need to ensure parseLog is called successfully
      (handler as any).l1BitcoinDepositor = {
        interface: {
          parseLog: jest.fn().mockReturnValue({
            args: { transferSequence: { toString: () => '456' } },
          }),
        },
      };

      const result = await handler.finalizeDeposit(testDeposit);

      expect(result).toBe(mockReceipt);

      // Import the mocked module to access the mock function
      const { updateToAwaitingWormholeVAA } = require('../../../utils/Deposits.js');
      expect(updateToAwaitingWormholeVAA).toHaveBeenCalledWith(
        '0xfinalize-hash',
        testDeposit,
        '456',
      );
    });
  });

  describe('Event Processing Integration', () => {
    it('should process SUI Move events correctly', async () => {
      const mockEvent = {
        type: '0x1db1fcdaada7c286d77f3347e593e06d8f33b8255e0861033a0a9f321f4eade7::bitcoin_depositor::DepositInitialized',
        parsedJson: {
          deposit_key: 'integration-test-deposit',
          funding_tx_hash: '0xbitcoin-funding-hash',
          output_index: 2,
          depositor: '0xsui-depositor-address',
        },
        id: {
          txDigest: 'sui-transaction-digest',
        },
        checkpoint: 67890,
      };

      // Mock DepositStore
      jest.spyOn(DepositStore, 'getById').mockResolvedValue(null);

      await (handler as any).initializeL2();
      await (handler as any).handleSuiDepositEvent(mockEvent);

      // Verify the event was processed
      expect(DepositStore.getById).toHaveBeenCalledWith('integration-test-deposit');
    });

    it('should query past events with pagination', async () => {
      const mockEventsPage1 = {
        data: [
          {
            type: '0x1db1fcdaada7c286d77f3347e593e06d8f33b8255e0861033a0a9f321f4eade7::bitcoin_depositor::DepositInitialized',
            parsedJson: { deposit_key: 'past-deposit-1' },
          },
        ],
        hasNextPage: true,
        nextCursor: 'cursor-1',
      };

      const mockEventsPage2 = {
        data: [
          {
            type: '0x1db1fcdaada7c286d77f3347e593e06d8f33b8255e0861033a0a9f321f4eade7::bitcoin_depositor::DepositInitialized',
            parsedJson: { deposit_key: 'past-deposit-2' },
          },
        ],
        hasNextPage: false,
        nextCursor: null,
      };

      const mockSuiClient = {
        queryEvents: jest
          .fn()
          .mockResolvedValueOnce(mockEventsPage1)
          .mockResolvedValueOnce(mockEventsPage2),
      };

      const { SuiClient } = require('@mysten/sui/client');
      SuiClient.mockImplementation(() => mockSuiClient);

      await (handler as any).initializeL2();

      const options = { pastTimeInMinutes: 120, latestBlock: 10000 };
      await handler.checkForPastDeposits(options);

      // Verify pagination worked correctly
      expect(mockSuiClient.queryEvents).toHaveBeenCalledTimes(2);
      expect(mockSuiClient.queryEvents).toHaveBeenNthCalledWith(1, {
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
      expect(mockSuiClient.queryEvents).toHaveBeenNthCalledWith(2, {
        query: {
          MoveModule: {
            package: '0x1db1fcdaada7c286d77f3347e593e06d8f33b8255e0861033a0a9f321f4eade7',
            module: 'bitcoin_depositor',
          },
        },
        cursor: 'cursor-1',
        limit: 50,
        order: 'descending',
      });
    });
  });

  describe('Error Recovery Integration', () => {
    it('should handle SUI RPC failures gracefully', async () => {
      const { SuiClient } = require('@mysten/sui/client');
      SuiClient.mockImplementation(() => {
        throw new Error('SUI RPC unreachable');
      });

      await expect((handler as any).initializeL2()).rejects.toThrow('SUI RPC unreachable');
    });

    it('should recover from checkpoint query failures', async () => {
      const mockSuiClient = {
        getLatestCheckpointSequenceNumber: jest
          .fn()
          .mockRejectedValue(new Error('Checkpoint query failed')),
      };

      const { SuiClient } = require('@mysten/sui/client');
      SuiClient.mockImplementation(() => mockSuiClient);

      await (handler as any).initializeL2();

      const latestBlock = await handler.getLatestBlock();

      expect(latestBlock).toBe(0);
      expect(mockSuiClient.getLatestCheckpointSequenceNumber).toHaveBeenCalled();
    });

    it('should handle event subscription failures', async () => {
      const mockSuiClient = {
        subscribeEvent: jest.fn().mockRejectedValue(new Error('WebSocket connection failed')),
      };

      const { SuiClient } = require('@mysten/sui/client');
      SuiClient.mockImplementation(() => mockSuiClient);

      const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
      Ed25519Keypair.fromSecretKey.mockReturnValue({
        publicKey: jest.fn().mockReturnValue('mock-public-key'),
      });

      await (handler as any).initializeL2();

      await expect((handler as any).setupL2Listeners()).rejects.toThrow(
        'WebSocket connection failed',
      );
    });
  });

  describe('Configuration Validation Integration', () => {
    it('should validate SUI-specific configuration requirements', async () => {
      // Test that invalid private key fails during initialization, not construction
      const invalidConfig = { ...mockConfig, suiPrivateKey: 'invalid-key' };
      const handlerWithInvalidKey = new SuiChainHandler(invalidConfig);

      await expect((handlerWithInvalidKey as any).initializeL2()).rejects.toThrow();

      expect(() => {
        const invalidConfig = { ...mockConfig, chainType: CHAIN_TYPE.EVM };
        new SuiChainHandler(invalidConfig as any);
      }).toThrow('Incorrect chain type Evm provided to SuiChainHandler');
    });

    it('should handle optional gas object configuration', () => {
      const configWithoutGasObject = { ...mockConfig, suiGasObjectId: undefined };
      const handlerWithoutGasObject = new SuiChainHandler(configWithoutGasObject);

      expect(handlerWithoutGasObject.config.suiGasObjectId).toBeUndefined();

      const configWithGasObject = { ...mockConfig, suiGasObjectId: '0xgasobjectid' };
      const handlerWithGasObject = new SuiChainHandler(configWithGasObject);

      expect(handlerWithGasObject.config.suiGasObjectId).toBe('0xgasobjectid');
    });
  });

  describe('Wormhole Integration End-to-End', () => {
    it('should complete full Wormhole workflow simulation', async () => {
      // Setup complete workflow mocks
      const mockSuiClient = {
        getLatestCheckpointSequenceNumber: jest.fn().mockResolvedValue('100000'),
        subscribeEvent: jest.fn().mockResolvedValue(() => jest.fn()),
        signAndExecuteTransaction: jest.fn().mockResolvedValue({
          digest: 'wormhole-bridge-digest',
          effects: { status: { status: 'success' } },
        }),
      };

      const { SuiClient } = require('@mysten/sui/client');
      SuiClient.mockImplementation(() => mockSuiClient);

      const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
      Ed25519Keypair.fromSecretKey.mockReturnValue({
        publicKey: jest.fn().mockReturnValue('mock-public-key'),
      });

      // Mock complete Wormhole workflow
      (handler as any).wormhole.getVaa.mockResolvedValue({
        binary: new Uint8Array([1, 2, 3, 4, 5]),
      });

      await (handler as any).initializeL2();

      // Test the complete workflow
      const testDeposit = {
        id: 'end-to-end-test',
        status: DepositStatus.AWAITING_WORMHOLE_VAA,
        wormholeInfo: {
          txHash: '0xe2e-test-hash',
          transferSequence: '999',
          bridgingAttempted: false,
        },
      } as Deposit;

      await (handler as any).bridgeSuiDeposit(testDeposit);

      // Verify Wormhole components were called
      expect((handler as any).wormhole.getChain).toHaveBeenCalledWith('Ethereum');
      expect((handler as any).wormhole.getVaa).toHaveBeenCalled();
    });
  });
});
