import { EVMChainHandler } from '../../../handlers/EVMChainHandler.js';
import {
  EvmChainConfigSchema,
  type EvmChainConfig,
} from '../../../config/schemas/evm.chain.schema.js';
import { CHAIN_TYPE, NETWORK } from '../../../config/schemas/common.schema.js';
import { DepositStore } from '../../../utils/DepositStore.js';
import logger from '../../../utils/Logger.js';
import { DepositStatus } from '../../../types/DepositStatus.enum.js';
import type { Deposit } from '../../../types/Deposit.type.js';
import * as depositUtils from '../../../utils/Deposits.js';
import * as wormholeVAAModule from '../../../utils/WormholeVAA.js';
import { ethers } from 'ethers';

// Mock external dependencies
jest.mock('../../../utils/DepositStore');
jest.mock('../../../utils/Logger');
jest.mock('../../../utils/Deposits');
jest.mock('../../../utils/AuditLog');
jest.mock('../../../utils/WormholeVAA');

// Mock the config module to prevent loading all chain configurations during unit tests
jest.mock('../../../config/index.js', () => ({
  chainConfigs: {},
  getAvailableChainKeys: () => ['baseSepolia'],
}));

// Mock Wormhole SDK
jest.mock('@wormhole-foundation/sdk', () => ({
  Wormhole: {
    parseAddress: jest.fn().mockReturnValue('mock-address'),
  },
}));

// Compute the correct EVM event signature for topic matching
const EVM_TOKENS_TRANSFERRED_SIG = ethers.utils.id(
  'TokensTransferredWithPayload(uint256,address,uint64)',
);

// Valid EVM config that passes EvmChainConfigSchema.parse()
const mockEvmConfig: EvmChainConfig = {
  ...EvmChainConfigSchema.parse({
    chainName: 'BaseSepolia',
    network: NETWORK.TESTNET,
    chainType: CHAIN_TYPE.EVM,
    l1Rpc: 'http://l1-rpc.test',
    l2Rpc: 'http://l2-rpc.test',
    l2WsRpc: 'ws://l2-ws.test',
    l1BitcoinDepositorAddress: '0x1234567890123456789012345678901234567890',
    l2BitcoinDepositorAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    vaultAddress: '0xaabbccddaabbccddaabbccddaabbccddaabbccdd',
    privateKey: 'a'.repeat(64),
    l2WormholeGatewayAddress: '0x1111111111111111111111111111111111111111',
    l2WormholeChainId: 30,
    l2BitcoinDepositorStartBlock: 0,
    l1Confirmations: 1,
    useEndpoint: false,
    enableL2Redemption: false,
  }),
};

// Mainnet config variant for URL/emitter tests
const mockEvmConfigMainnet: EvmChainConfig = {
  ...EvmChainConfigSchema.parse({
    chainName: 'BaseMainnet',
    network: NETWORK.MAINNET,
    chainType: CHAIN_TYPE.EVM,
    l1Rpc: 'http://l1-rpc.test',
    l2Rpc: 'http://l2-rpc.test',
    l2WsRpc: 'ws://l2-ws.test',
    l1BitcoinDepositorAddress: '0x1234567890123456789012345678901234567890',
    l2BitcoinDepositorAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    vaultAddress: '0xaabbccddaabbccddaabbccddaabbccddaabbccdd',
    privateKey: 'a'.repeat(64),
    l2WormholeGatewayAddress: '0x1111111111111111111111111111111111111111',
    l2WormholeChainId: 30,
    l2BitcoinDepositorStartBlock: 0,
    l1Confirmations: 1,
    useEndpoint: false,
    enableL2Redemption: false,
  }),
};

describe('EVMChainHandler', () => {
  let handler: EVMChainHandler;
  let mockDepositStore: jest.Mocked<typeof DepositStore>;
  let mockDepositsUtil: jest.Mocked<typeof depositUtils>;

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

    mockDepositStore = DepositStore as jest.Mocked<typeof DepositStore>;
    mockDepositsUtil = depositUtils as jest.Mocked<typeof depositUtils>;

    // Setup default mock implementations
    mockDepositStore.getById = jest.fn().mockResolvedValue(null);
    mockDepositStore.getByStatus = jest.fn().mockResolvedValue([]);
    mockDepositStore.create = jest.fn().mockResolvedValue(undefined);
    (mockDepositsUtil as any).updateToAwaitingWormholeVAA = jest.fn().mockResolvedValue(undefined);
    (mockDepositsUtil as any).updateToBridgedDeposit = jest.fn().mockResolvedValue(undefined);

    // Create handler instance
    handler = new EVMChainHandler(mockEvmConfig);

    // Mock the wormhole property
    (handler as any).wormhole = mockWormhole;
  });

  describe('finalizeDeposit', () => {
    let mockDeposit: Deposit;
    let mockReceipt: any;

    beforeEach(() => {
      mockDeposit = {
        id: 'test-evm-deposit-id',
        chainId: 'BaseSepolia',
        status: DepositStatus.INITIALIZED,
        wormholeInfo: {
          txHash: null,
          transferSequence: null,
          bridgingAttempted: false,
        },
      } as Deposit;

      mockReceipt = {
        transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        blockNumber: 12345,
        logs: [
          {
            address: '0x1234567890123456789012345678901234567890',
            topics: [EVM_TOKENS_TRANSFERRED_SIG],
            data: '0x',
            logIndex: 0,
            blockNumber: 12345,
            transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
            transactionIndex: 0,
            blockHash: '0x' + '0'.repeat(64),
            removed: false,
          },
        ],
      };

      // Mock the parent finalizeDeposit call
      jest
        .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(handler)), 'finalizeDeposit')
        .mockResolvedValue(mockReceipt);

      // Mock the l1BitcoinDepositorProvider interface for parseLog
      (handler as any).l1BitcoinDepositorProvider = {
        interface: {
          parseLog: jest.fn().mockReturnValue({
            name: 'TokensTransferredWithPayload',
            args: { transferSequence: ethers.BigNumber.from(42) },
          }),
        },
      };
    });

    it('should extract transferSequence via Method 1 (parseLog) and call updateToAwaitingWormholeVAA', async () => {
      const result = await handler.finalizeDeposit(mockDeposit);

      expect(result).toBe(mockReceipt);
      expect(mockDepositsUtil.updateToAwaitingWormholeVAA).toHaveBeenCalledWith(
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        mockDeposit,
        '42',
      );
    });

    it('should return early when super.finalizeDeposit returns undefined', async () => {
      jest
        .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(handler)), 'finalizeDeposit')
        .mockResolvedValueOnce(undefined);

      const result = await handler.finalizeDeposit(mockDeposit);

      expect(result).toBeUndefined();
      expect(mockDepositsUtil.updateToAwaitingWormholeVAA).not.toHaveBeenCalled();
    });

    it('should handle receipt with no matching logs gracefully', async () => {
      const receiptWithoutLogs = {
        ...mockReceipt,
        logs: [],
      };

      jest
        .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(handler)), 'finalizeDeposit')
        .mockResolvedValueOnce(receiptWithoutLogs);

      const result = await handler.finalizeDeposit(mockDeposit);

      expect(result).toBe(receiptWithoutLogs);
      expect(mockDepositsUtil.updateToAwaitingWormholeVAA).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(mockDeposit.id));
    });

    it('should not extract sequence when log has correct topic but wrong contract address', async () => {
      // Logs are filtered by BOTH address AND topic before parsing.
      // A log from a different contract (even with matching topic) is ignored.
      const parseLogMock = jest.fn();
      (handler as any).l1BitcoinDepositorProvider = {
        interface: { parseLog: parseLogMock },
      };

      const receiptWithWrongAddress = {
        ...mockReceipt,
        logs: [
          {
            address: '0x9999999999999999999999999999999999999999',
            topics: [EVM_TOKENS_TRANSFERRED_SIG],
            data: '0x',
            logIndex: 0,
            blockNumber: 12345,
            transactionHash: mockReceipt.transactionHash,
            transactionIndex: 0,
            blockHash: '0x' + '0'.repeat(64),
            removed: false,
          },
        ],
      };

      jest
        .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(handler)), 'finalizeDeposit')
        .mockResolvedValueOnce(receiptWithWrongAddress);

      const result = await handler.finalizeDeposit(mockDeposit);

      expect(result).toBe(receiptWithWrongAddress);
      expect(parseLogMock).not.toHaveBeenCalled();
      expect(mockDepositsUtil.updateToAwaitingWormholeVAA).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(mockDeposit.id));
    });

    it('should not extract sequence when log has correct address but wrong topic', async () => {
      // Logs are filtered by BOTH address AND topic before parsing.
      // A log from the correct contract with a non-matching topic is ignored.
      const parseLogMock = jest.fn();
      (handler as any).l1BitcoinDepositorProvider = {
        interface: { parseLog: parseLogMock },
      };

      const l1DepositorAddress = mockEvmConfig.l1BitcoinDepositorAddress;
      const receiptWithWrongTopic = {
        ...mockReceipt,
        logs: [
          {
            address: l1DepositorAddress,
            topics: ['0x' + 'ff'.repeat(32)], // non-matching topic
            data: '0x',
            logIndex: 0,
            blockNumber: 12345,
            transactionHash: mockReceipt.transactionHash,
            transactionIndex: 0,
            blockHash: '0x' + '0'.repeat(64),
            removed: false,
          },
        ],
      };

      jest
        .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(handler)), 'finalizeDeposit')
        .mockResolvedValueOnce(receiptWithWrongTopic);

      const result = await handler.finalizeDeposit(mockDeposit);

      expect(result).toBe(receiptWithWrongTopic);
      expect(parseLogMock).not.toHaveBeenCalled();
      expect(mockDepositsUtil.updateToAwaitingWormholeVAA).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(mockDeposit.id));
    });

    it('should convert transferSequence BigNumber to string correctly', async () => {
      (handler as any).l1BitcoinDepositorProvider = {
        interface: {
          parseLog: jest.fn().mockReturnValue({
            name: 'TokensTransferredWithPayload',
            args: { transferSequence: ethers.BigNumber.from(999999) },
          }),
        },
      };

      await handler.finalizeDeposit(mockDeposit);

      expect(mockDepositsUtil.updateToAwaitingWormholeVAA).toHaveBeenCalledWith(
        expect.any(String),
        mockDeposit,
        '999999',
      );
    });

    it('should use correct transaction hash from receipt', async () => {
      const specificTxHash = '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff';
      const receiptWithSpecificHash = {
        ...mockReceipt,
        transactionHash: specificTxHash,
      };

      jest
        .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(handler)), 'finalizeDeposit')
        .mockResolvedValueOnce(receiptWithSpecificHash);

      await handler.finalizeDeposit(mockDeposit);

      expect(mockDepositsUtil.updateToAwaitingWormholeVAA).toHaveBeenCalledWith(
        specificTxHash,
        mockDeposit,
        expect.any(String),
      );
    });
  });

  describe('processWormholeBridging', () => {
    let mockDeposits: Deposit[];

    beforeEach(() => {
      mockDeposits = [
        {
          id: 'evm-deposit-1',
          chainId: 'BaseSepolia',
          status: DepositStatus.AWAITING_WORMHOLE_VAA,
          wormholeInfo: {
            txHash: '0xtest-tx-hash-1',
            transferSequence: '123',
            bridgingAttempted: false,
          },
        } as Deposit,
        {
          id: 'evm-deposit-2',
          chainId: 'BaseSepolia',
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

    it('should query deposits with AWAITING_WORMHOLE_VAA status for this chain', async () => {
      // Spy on bridgeEvmDeposit to prevent actual execution
      jest.spyOn(handler as any, 'bridgeEvmDeposit').mockResolvedValue(undefined);

      await handler.processWormholeBridging();

      expect(mockDepositStore.getByStatus).toHaveBeenCalledWith(
        DepositStatus.AWAITING_WORMHOLE_VAA,
        'BaseSepolia',
      );
    });

    it('should return early when no deposits are awaiting bridging', async () => {
      mockDepositStore.getByStatus.mockResolvedValue([]);

      const bridgeSpy = jest.spyOn(handler as any, 'bridgeEvmDeposit').mockResolvedValue(undefined);

      await handler.processWormholeBridging();

      expect(bridgeSpy).not.toHaveBeenCalled();
    });

    it('should skip deposits without transferSequence', async () => {
      const depositsWithoutSequence = [
        {
          id: 'deposit-no-sequence',
          chainId: 'BaseSepolia',
          status: DepositStatus.AWAITING_WORMHOLE_VAA,
          wormholeInfo: {
            txHash: '0xtest-tx-hash',
            transferSequence: null,
            bridgingAttempted: false,
          },
        },
      ] as Deposit[];

      mockDepositStore.getByStatus.mockResolvedValue(depositsWithoutSequence);

      const bridgeSpy = jest.spyOn(handler as any, 'bridgeEvmDeposit').mockResolvedValue(undefined);

      await handler.processWormholeBridging();

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('missing transferSequence'));
      expect(bridgeSpy).not.toHaveBeenCalled();
    });

    it('should call bridgeEvmDeposit for each qualifying deposit', async () => {
      const bridgeSpy = jest.spyOn(handler as any, 'bridgeEvmDeposit').mockResolvedValue(undefined);

      await handler.processWormholeBridging();

      expect(bridgeSpy).toHaveBeenCalledTimes(2);
      expect(bridgeSpy).toHaveBeenCalledWith(mockDeposits[0]);
      expect(bridgeSpy).toHaveBeenCalledWith(mockDeposits[1]);
    });
  });

  describe('fetchVAAFromAPI (shared utility)', () => {
    let originalFetch: typeof global.fetch;
    // Use the real implementation for these tests (unmock the module)
    const { fetchVAAFromAPI: realFetchVAA } = jest.requireActual('../../../utils/WormholeVAA.js');

    beforeEach(() => {
      originalFetch = global.fetch;
      jest.useFakeTimers();
    });

    afterEach(() => {
      global.fetch = originalFetch;
      jest.useRealTimers();
    });

    it('should construct correct Wormhole API URL for testnet', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { vaa: 'dGVzdHZhYQ==' } }),
      });
      global.fetch = mockFetch;

      const expectedEmitter = '4a8bc80ed5a4067f1ccf107057b8270e0cc11a78'.padStart(64, '0');

      const resultPromise = realFetchVAA('456', NETWORK.TESTNET);
      await jest.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api.testnet.wormholescan.io'),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/10002/${expectedEmitter}/456`),
      );
      expect(result).toBe('dGVzdHZhYQ==');
    });

    it('should construct correct Wormhole API URL for mainnet', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { vaa: 'mainnetvaa' } }),
      });
      global.fetch = mockFetch;

      const resultPromise = realFetchVAA('123', NETWORK.MAINNET);
      await jest.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('api.wormholescan.io'));
      expect(mockFetch).toHaveBeenCalledWith(expect.not.stringContaining('testnet'));
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/2/'));
      expect(result).toBe('mainnetvaa');
    });

    it('should return base64 VAA on successful response', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { vaa: 'base64vaastring' } }),
      });
      global.fetch = mockFetch;

      const resultPromise = realFetchVAA('789', NETWORK.TESTNET);
      await jest.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;

      expect(result).toBe('base64vaastring');
    });

    it('should return null on 404 response (single attempt, retry handled by caller)', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
      global.fetch = mockFetch;

      const resultPromise = realFetchVAA('100', NETWORK.TESTNET);
      await jest.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).toBeNull();
    });

    it('should return null on repeated 404 responses (single attempt per call)', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
      global.fetch = mockFetch;

      const result = await realFetchVAA('999', NETWORK.TESTNET);

      expect(result).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle fetch network errors gracefully and return null', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('Network error'));
      global.fetch = mockFetch;

      const result = await realFetchVAA('200', NETWORK.TESTNET);

      expect(result).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should use correct Token Bridge emitter address for mainnet', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { vaa: 'vaa' } }),
      });
      global.fetch = mockFetch;

      const expectedMainnetEmitter =
        '0000000000000000000000003ee18b2214aff97000d974cf647e7c347e8fa585';

      const resultPromise = realFetchVAA('300', NETWORK.MAINNET);
      await jest.advanceTimersByTimeAsync(1000);
      await resultPromise;

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining(expectedMainnetEmitter));
    });
  });

  describe('bridgeEvmDeposit', () => {
    let mockDeposit: Deposit;
    let mockReceiveTbtc: jest.Mock;
    let mockWait: jest.Mock;

    beforeEach(() => {
      mockDeposit = {
        id: 'bridge-deposit-1',
        chainId: 'BaseSepolia',
        status: DepositStatus.AWAITING_WORMHOLE_VAA,
        wormholeInfo: {
          txHash: '0xbridge-tx-hash',
          transferSequence: '42',
          bridgingAttempted: false,
        },
      } as Deposit;

      // Set up mock L2WormholeGateway contract
      mockWait = jest.fn().mockResolvedValue({
        transactionHash: '0xreceipt-tx-hash',
        blockNumber: 99999,
      });
      mockReceiveTbtc = jest.fn().mockResolvedValue({ wait: mockWait });

      (handler as any).l2WormholeGateway = {
        receiveTbtc: mockReceiveTbtc,
      };

      // Mock shared fetchVAAFromAPI to return a valid base64 VAA
      // 'AQID' is base64 for bytes [1, 2, 3]
      (wormholeVAAModule.fetchVAAFromAPI as jest.Mock).mockResolvedValue('AQID');
    });

    it('should call receiveTbtc with hex-encoded VAA bytes', async () => {
      await handler.bridgeEvmDeposit(mockDeposit);

      // base64 'AQID' decodes to [0x01, 0x02, 0x03] -> hex '0x010203'
      expect(mockReceiveTbtc).toHaveBeenCalledWith('0x010203');
    });

    it('should call updateToBridgedDeposit on successful transaction', async () => {
      await handler.bridgeEvmDeposit(mockDeposit);

      expect(mockDepositsUtil.updateToBridgedDeposit).toHaveBeenCalledWith(
        mockDeposit,
        '0xreceipt-tx-hash',
        'Evm',
      );
    });

    it('should return early when deposit status is not AWAITING_WORMHOLE_VAA', async () => {
      const wrongStatusDeposit = {
        ...mockDeposit,
        status: DepositStatus.INITIALIZED,
      };

      await handler.bridgeEvmDeposit(wrongStatusDeposit);

      expect(wormholeVAAModule.fetchVAAFromAPI).not.toHaveBeenCalled();
      expect(mockReceiveTbtc).not.toHaveBeenCalled();
    });

    it('should warn and return when transferSequence is missing', async () => {
      const depositNoSequence = {
        ...mockDeposit,
        wormholeInfo: {
          txHash: '0xbridge-tx-hash',
          transferSequence: null,
          bridgingAttempted: false,
        },
      };

      await handler.bridgeEvmDeposit(depositNoSequence);

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No transfer sequence'));
      expect(wormholeVAAModule.fetchVAAFromAPI).not.toHaveBeenCalled();
    });

    it('should handle null VAA from fetchVAAFromAPI gracefully', async () => {
      (wormholeVAAModule.fetchVAAFromAPI as jest.Mock).mockResolvedValue(null);

      await handler.bridgeEvmDeposit(mockDeposit);

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('VAA not yet available'));
      expect(mockReceiveTbtc).not.toHaveBeenCalled();
      expect(mockDepositsUtil.updateToBridgedDeposit).not.toHaveBeenCalled();
    });

    it('should warn when L2WormholeGateway contract is not initialized', async () => {
      (handler as any).l2WormholeGateway = undefined;

      await handler.bridgeEvmDeposit(mockDeposit);

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(mockDeposit.id));
      expect(mockReceiveTbtc).not.toHaveBeenCalled();
    });

    it('should handle L2 transaction failure gracefully', async () => {
      mockReceiveTbtc.mockRejectedValue(new Error('Transaction reverted'));

      await handler.bridgeEvmDeposit(mockDeposit);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Wormhole bridging failed'),
        expect.any(Object),
      );
      expect(mockDepositsUtil.updateToBridgedDeposit).not.toHaveBeenCalled();
    });
  });

  describe('initializeL2 - L2WormholeGateway', () => {
    it('should initialize L2WormholeGateway contract when config is present', async () => {
      // Before initialization, the property should be undefined
      expect((handler as any).l2WormholeGateway).toBeUndefined();

      await (handler as any).initializeL2();

      // After initializeL2, the L2WormholeGateway contract should be defined
      expect((handler as any).l2WormholeGateway).toBeDefined();
    });

    it('should not initialize L2WormholeGateway when l2WormholeGatewayAddress is missing', async () => {
      const configWithoutGateway = {
        ...mockEvmConfig,
        l2WormholeGatewayAddress: undefined,
      };
      const handlerNoGateway = new EVMChainHandler(configWithoutGateway as EvmChainConfig);

      await (handlerNoGateway as any).initializeL2();

      expect((handlerNoGateway as any).l2WormholeGateway).toBeUndefined();
    });
  });

  describe('recoverStuckFinalizedDeposits', () => {
    const TEN_MINUTES_MS = 10 * 60 * 1000;
    const TWO_MINUTES_MS = 2 * 60 * 1000;

    let mockL1Provider: any;
    let mockParseLog: jest.Mock;

    // Helper to create a FINALIZED deposit with configurable age and tx hash
    function makeFinalizedDeposit(
      overrides: {
        id?: string;
        finalizationAt?: number | null;
        finalizeTxHash?: string | null;
      } = {},
    ): Deposit {
      return {
        id: overrides.id ?? 'finalized-deposit-1',
        chainId: 'BaseSepolia',
        status: DepositStatus.FINALIZED,
        dates: {
          createdAt: Date.now() - TEN_MINUTES_MS,
          initializationAt: Date.now() - TEN_MINUTES_MS,
          finalizationAt:
            overrides.finalizationAt !== undefined
              ? overrides.finalizationAt
              : Date.now() - TEN_MINUTES_MS,
          lastActivityAt: Date.now() - TEN_MINUTES_MS,
          awaitingWormholeVAAMessageSince: null,
          bridgedAt: null,
        },
        hashes: {
          btc: { btcTxHash: '0xbtc' },
          eth: {
            initializeTxHash: '0xinit',
            finalizeTxHash:
              overrides.finalizeTxHash !== undefined
                ? overrides.finalizeTxHash
                : '0xfinalize-tx-hash',
          },
          solana: { bridgeTxHash: null },
        },
        wormholeInfo: {
          txHash: null,
          transferSequence: null,
          bridgingAttempted: false,
        },
        fundingTxHash: '0xfunding',
        outputIndex: 0,
        receipt: {
          depositor: '0xdepositor',
          blindingFactor: '0x',
          walletPublicKeyHash: '0x',
          refundPublicKeyHash: '0x',
          refundLocktime: '0',
          extraData: '0xowner',
        },
        owner: '0xowner',
        L1OutputEvent: {
          fundingTx: { version: '0', inputVector: '0x', outputVector: '0x', locktime: '0' },
          reveal: {
            blindingFactor: '0x',
            fundingOutputIndex: 0,
            refundLocktime: '0',
            refundPubKeyHash: '0x',
            vault: '0x',
            walletPubKeyHash: '0x',
          },
          l2DepositOwner: '0xowner',
          l2Sender: '0xsender',
        },
        error: null,
      } as Deposit;
    }

    // Helper to create an AWAITING_WORMHOLE_VAA deposit
    function makeAwaitingDeposit(
      overrides: {
        id?: string;
        awaitingSince?: number | null;
        finalizationAt?: number | null;
      } = {},
    ): Deposit {
      const base = makeFinalizedDeposit({
        id: overrides.id ?? 'awaiting-deposit-1',
        finalizationAt: overrides.finalizationAt ?? Date.now() - TEN_MINUTES_MS,
      });
      return {
        ...base,
        status: DepositStatus.AWAITING_WORMHOLE_VAA,
        dates: {
          ...base.dates,
          awaitingWormholeVAAMessageSince:
            overrides.awaitingSince !== undefined
              ? overrides.awaitingSince
              : Date.now() - TEN_MINUTES_MS,
        },
        wormholeInfo: {
          txHash: '0xwormhole-tx',
          transferSequence: '42',
          bridgingAttempted: false,
        },
      } as Deposit;
    }

    beforeEach(() => {
      mockParseLog = jest.fn().mockReturnValue({
        name: 'TokensTransferredWithPayload',
        args: {
          transferSequence: ethers.BigNumber.from(99),
          l2Receiver: '0xowner',
        },
      });

      mockL1Provider = {
        getTransactionReceipt: jest.fn().mockResolvedValue({
          blockNumber: 100,
          transactionHash: '0xfinalize-tx-hash',
        }),
        getBlockNumber: jest.fn().mockResolvedValue(200),
        getBlock: jest.fn().mockResolvedValue({
          timestamp: Math.floor(Date.now() / 1000),
          number: 200,
        }),
        getLogs: jest.fn().mockResolvedValue([
          {
            address: mockEvmConfig.l1BitcoinDepositorAddress,
            topics: [EVM_TOKENS_TRANSFERRED_SIG],
            data: '0x',
            transactionHash: '0xlog-tx-hash',
            blockNumber: 101,
          },
        ]),
      };

      (handler as any).l1Provider = mockL1Provider;
      (handler as any).l1BitcoinDepositorProvider = {
        interface: { parseLog: mockParseLog },
      };
    });

    it('should return early when deposits array is empty', async () => {
      await handler.recoverStuckFinalizedDeposits([]);

      // No FINALIZED recovery work should be done
      expect(mockL1Provider.getTransactionReceipt).not.toHaveBeenCalled();
      // AWAITING recovery phase still runs (getByStatus is called for AWAITING deposits)
    });

    it('should filter out deposits finalized less than 5 minutes ago', async () => {
      const oldDeposit = makeFinalizedDeposit({
        id: 'old-deposit',
        finalizationAt: Date.now() - TEN_MINUTES_MS,
      });
      const recentDeposit = makeFinalizedDeposit({
        id: 'recent-deposit',
        finalizationAt: Date.now() - TWO_MINUTES_MS,
      });

      await handler.recoverStuckFinalizedDeposits([oldDeposit, recentDeposit]);

      // Only the old deposit should trigger a receipt lookup
      expect(mockL1Provider.getTransactionReceipt).toHaveBeenCalledTimes(1);
      expect(mockL1Provider.getTransactionReceipt).toHaveBeenCalledWith('0xfinalize-tx-hash');
    });

    it('should filter out deposits with null finalizationAt', async () => {
      const noTimestampDeposit = makeFinalizedDeposit({
        id: 'no-timestamp',
        finalizationAt: null,
      });

      await handler.recoverStuckFinalizedDeposits([noTimestampDeposit]);

      expect(mockL1Provider.getTransactionReceipt).not.toHaveBeenCalled();
    });

    it('should recover FINALIZED deposit using finalizeTxHash to determine search start block', async () => {
      const deposit = makeFinalizedDeposit({ finalizeTxHash: '0xmy-finalize-hash' });

      mockL1Provider.getTransactionReceipt.mockResolvedValue({
        blockNumber: 150,
        transactionHash: '0xmy-finalize-hash',
      });

      await handler.recoverStuckFinalizedDeposits([deposit]);

      expect(mockL1Provider.getTransactionReceipt).toHaveBeenCalledWith('0xmy-finalize-hash');
      expect(mockDepositsUtil.updateToAwaitingWormholeVAA).toHaveBeenCalledWith(
        '0xlog-tx-hash',
        deposit,
        '99',
      );
    });

    it('should fall back to timestamp-based block estimation when finalizeTxHash is null', async () => {
      const deposit = makeFinalizedDeposit({
        finalizeTxHash: null,
        finalizationAt: Date.now() - TEN_MINUTES_MS,
      });

      await handler.recoverStuckFinalizedDeposits([deposit]);

      // Should use block estimation path (getBlockNumber + getBlock)
      expect(mockL1Provider.getTransactionReceipt).not.toHaveBeenCalled();
      expect(mockL1Provider.getBlockNumber).toHaveBeenCalled();
      expect(mockL1Provider.getBlock).toHaveBeenCalled();
      // Should still find the sequence via getLogs
      expect(mockDepositsUtil.updateToAwaitingWormholeVAA).toHaveBeenCalled();
    });

    it('should perform wider search when initial search returns null', async () => {
      const deposit = makeFinalizedDeposit();

      // First getLogs call returns empty (initial search fails),
      // second getLogs call returns a match (wider search succeeds)
      mockL1Provider.getLogs
        .mockResolvedValueOnce([]) // initial search: no results
        .mockResolvedValueOnce([
          // wider search: found match
          {
            address: mockEvmConfig.l1BitcoinDepositorAddress,
            topics: [EVM_TOKENS_TRANSFERRED_SIG],
            data: '0x',
            transactionHash: '0xwider-search-tx',
            blockNumber: 95,
          },
        ]);

      await handler.recoverStuckFinalizedDeposits([deposit]);

      // getLogs should be called twice (initial + wider search)
      expect(mockL1Provider.getLogs).toHaveBeenCalledTimes(2);
      expect(mockDepositsUtil.updateToAwaitingWormholeVAA).toHaveBeenCalledWith(
        '0xwider-search-tx',
        deposit,
        '99',
      );
    });

    it('should log warning when neither initial nor wider search finds sequence', async () => {
      const deposit = makeFinalizedDeposit();

      // Both searches return empty
      mockL1Provider.getLogs.mockResolvedValue([]);

      await handler.recoverStuckFinalizedDeposits([deposit]);

      expect(mockDepositsUtil.updateToAwaitingWormholeVAA).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(deposit.id));
    });

    it('should fetch and re-bridge AWAITING_WORMHOLE_VAA deposits', async () => {
      const finalizedDeposit = makeFinalizedDeposit();
      const awaitingDeposit = makeAwaitingDeposit({ id: 'awaiting-rebrid-1' });

      // DepositStore returns AWAITING deposits for the second recovery phase
      mockDepositStore.getByStatus.mockResolvedValue([awaitingDeposit]);

      // Spy on bridgeEvmDeposit to verify it is called for AWAITING deposits
      const bridgeSpy = jest.spyOn(handler, 'bridgeEvmDeposit').mockResolvedValue(undefined);

      await handler.recoverStuckFinalizedDeposits([finalizedDeposit]);

      expect(mockDepositStore.getByStatus).toHaveBeenCalledWith(
        DepositStatus.AWAITING_WORMHOLE_VAA,
        'BaseSepolia',
      );
      expect(bridgeSpy).toHaveBeenCalledWith(awaitingDeposit);
    });

    it('should apply 5-minute delay filter to AWAITING_WORMHOLE_VAA deposits', async () => {
      const oldAwaitingDeposit = makeAwaitingDeposit({
        id: 'old-awaiting',
        awaitingSince: Date.now() - TEN_MINUTES_MS,
        finalizationAt: Date.now() - TEN_MINUTES_MS,
      });
      const recentAwaitingDeposit = makeAwaitingDeposit({
        id: 'recent-awaiting',
        awaitingSince: Date.now() - TWO_MINUTES_MS,
        finalizationAt: Date.now() - TWO_MINUTES_MS,
      });

      mockDepositStore.getByStatus.mockResolvedValue([oldAwaitingDeposit, recentAwaitingDeposit]);

      const bridgeSpy = jest.spyOn(handler, 'bridgeEvmDeposit').mockResolvedValue(undefined);

      // Pass empty finalized array to skip that phase
      await handler.recoverStuckFinalizedDeposits([]);

      // Only the old awaiting deposit should be re-bridged
      expect(bridgeSpy).toHaveBeenCalledTimes(1);
      expect(bridgeSpy).toHaveBeenCalledWith(oldAwaitingDeposit);
    });

    it('should isolate errors per deposit -- one failure does not block others', async () => {
      const deposit1 = makeFinalizedDeposit({
        id: 'failing-deposit',
        finalizeTxHash: '0xfail-hash',
      });
      const deposit2 = makeFinalizedDeposit({
        id: 'succeeding-deposit',
        finalizeTxHash: '0xsuccess-hash',
      });

      // First deposit receipt lookup throws, second succeeds
      mockL1Provider.getTransactionReceipt
        .mockRejectedValueOnce(new Error('RPC timeout'))
        .mockResolvedValueOnce({
          blockNumber: 100,
          transactionHash: '0xsuccess-hash',
        });

      await handler.recoverStuckFinalizedDeposits([deposit1, deposit2]);

      // Second deposit should still be processed successfully
      expect(mockDepositsUtil.updateToAwaitingWormholeVAA).toHaveBeenCalledWith(
        '0xlog-tx-hash',
        deposit2,
        '99',
      );
    });

    it('should skip recovery when getTransactionReceipt returns null', async () => {
      const deposit = makeFinalizedDeposit({ finalizeTxHash: '0xorphan-hash' });

      mockL1Provider.getTransactionReceipt.mockResolvedValue(null);

      await handler.recoverStuckFinalizedDeposits([deposit]);

      expect(mockL1Provider.getLogs).not.toHaveBeenCalled();
      expect(mockDepositsUtil.updateToAwaitingWormholeVAA).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(deposit.id));
    });
  });

  describe('searchForTransferSequence', () => {
    let mockL1Provider: any;
    let mockParseLog: jest.Mock;

    beforeEach(() => {
      mockParseLog = jest.fn().mockReturnValue({
        name: 'TokensTransferredWithPayload',
        args: {
          transferSequence: ethers.BigNumber.from(77),
          l2Receiver: '0xowner',
        },
      });

      mockL1Provider = {
        getBlockNumber: jest.fn().mockResolvedValue(200),
        getLogs: jest.fn().mockResolvedValue([
          {
            address: mockEvmConfig.l1BitcoinDepositorAddress,
            topics: [EVM_TOKENS_TRANSFERRED_SIG],
            data: '0x',
            transactionHash: '0xfound-tx',
            blockNumber: 102,
          },
        ]),
      };

      (handler as any).l1Provider = mockL1Provider;
      (handler as any).l1BitcoinDepositorProvider = {
        interface: { parseLog: mockParseLog },
      };
    });

    it('should scan correct block range and return sequence when found', async () => {
      const deposit = {
        id: 'search-deposit-1',
        chainId: 'BaseSepolia',
        owner: '0xowner',
      } as Deposit;

      const result = await (handler as any).searchForTransferSequence(deposit, 100);

      expect(mockL1Provider.getLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          topics: [EVM_TOKENS_TRANSFERRED_SIG],
          fromBlock: 100,
          toBlock: 105, // startBlock(100) + default searchBlocks(5)
        }),
      );
      expect(result).toEqual({ sequence: '77', txHash: '0xfound-tx' });
    });

    it('should respect configurable searchBlocks parameter', async () => {
      const deposit = { id: 'search-deposit-2', owner: '0xowner' } as Deposit;

      await (handler as any).searchForTransferSequence(deposit, 100, 30);

      expect(mockL1Provider.getLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          fromBlock: 100,
          toBlock: 130, // startBlock(100) + searchBlocks(30)
        }),
      );
    });

    it('should cap endBlock at current block number', async () => {
      const deposit = { id: 'search-deposit-3', owner: '0xowner' } as Deposit;
      mockL1Provider.getBlockNumber.mockResolvedValue(200);

      await (handler as any).searchForTransferSequence(deposit, 198);

      // endBlock should be min(198+5=203, 200) = 200
      expect(mockL1Provider.getLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          fromBlock: 198,
          toBlock: 200,
        }),
      );
    });

    it('should return null when no matching logs found', async () => {
      const deposit = { id: 'search-deposit-4', owner: '0xowner' } as Deposit;
      mockL1Provider.getLogs.mockResolvedValue([]);

      const result = await (handler as any).searchForTransferSequence(deposit, 100);

      expect(result).toBeNull();
      expect(mockParseLog).not.toHaveBeenCalled();
    });

    it('should filter logs by l1BitcoinDepositorAddress', async () => {
      const deposit = { id: 'search-deposit-5', owner: '0xowner' } as Deposit;

      // Return logs from two different addresses
      mockL1Provider.getLogs.mockResolvedValue([
        {
          address: '0x9999999999999999999999999999999999999999', // wrong address
          topics: [EVM_TOKENS_TRANSFERRED_SIG],
          data: '0x',
          transactionHash: '0xwrong-addr-tx',
          blockNumber: 101,
        },
        {
          address: mockEvmConfig.l1BitcoinDepositorAddress, // correct address
          topics: [EVM_TOKENS_TRANSFERRED_SIG],
          data: '0x',
          transactionHash: '0xcorrect-addr-tx',
          blockNumber: 102,
        },
      ]);

      const result = await (handler as any).searchForTransferSequence(deposit, 100);

      // Should return the log from the correct address only
      expect(result).toEqual({ sequence: '77', txHash: '0xcorrect-addr-tx' });
      // parseLog should only be called for the matching address log
      expect(mockParseLog).toHaveBeenCalledTimes(1);
    });

    it('should skip events where l2Receiver does not match deposit owner', async () => {
      const deposit = { id: 'search-deposit-corr', owner: '0xAlice' } as Deposit;

      // Two logs from the correct contract address
      mockL1Provider.getLogs.mockResolvedValue([
        {
          address: mockEvmConfig.l1BitcoinDepositorAddress,
          topics: [EVM_TOKENS_TRANSFERRED_SIG],
          data: '0x',
          transactionHash: '0xbob-tx',
          blockNumber: 101,
        },
        {
          address: mockEvmConfig.l1BitcoinDepositorAddress,
          topics: [EVM_TOKENS_TRANSFERRED_SIG],
          data: '0x',
          transactionHash: '0xalice-tx',
          blockNumber: 102,
        },
      ]);

      // First event belongs to Bob, second to Alice
      mockParseLog
        .mockReturnValueOnce({
          name: 'TokensTransferredWithPayload',
          args: {
            transferSequence: ethers.BigNumber.from(10),
            l2Receiver: '0xBob',
          },
        })
        .mockReturnValueOnce({
          name: 'TokensTransferredWithPayload',
          args: {
            transferSequence: ethers.BigNumber.from(20),
            l2Receiver: '0xAlice',
          },
        });

      const result = await (handler as any).searchForTransferSequence(deposit, 100);

      // Should skip Bob's event and return Alice's
      expect(result).toEqual({ sequence: '20', txHash: '0xalice-tx' });
      expect(mockParseLog).toHaveBeenCalledTimes(2);
    });

    it('should return null when all events belong to other deposits', async () => {
      const deposit = { id: 'search-deposit-nomatch', owner: '0xAlice' } as Deposit;

      mockL1Provider.getLogs.mockResolvedValue([
        {
          address: mockEvmConfig.l1BitcoinDepositorAddress,
          topics: [EVM_TOKENS_TRANSFERRED_SIG],
          data: '0x',
          transactionHash: '0xbob-tx',
          blockNumber: 101,
        },
      ]);

      mockParseLog.mockReturnValue({
        name: 'TokensTransferredWithPayload',
        args: {
          transferSequence: ethers.BigNumber.from(10),
          l2Receiver: '0xBob',
        },
      });

      const result = await (handler as any).searchForTransferSequence(deposit, 100);

      expect(result).toBeNull();
    });

    it('should handle getLogs errors gracefully', async () => {
      const deposit = { id: 'search-deposit-6', owner: '0xowner' } as Deposit;
      mockL1Provider.getLogs.mockRejectedValue(new Error('RPC error'));

      const result = await (handler as any).searchForTransferSequence(deposit, 100);

      expect(result).toBeNull();
    });

    it('should handle parseLog errors gracefully and continue', async () => {
      const deposit = { id: 'search-deposit-7', owner: '0xowner' } as Deposit;

      // Two logs from the correct address
      mockL1Provider.getLogs.mockResolvedValue([
        {
          address: mockEvmConfig.l1BitcoinDepositorAddress,
          topics: [EVM_TOKENS_TRANSFERRED_SIG],
          data: '0xbaddata',
          transactionHash: '0xfirst-tx',
          blockNumber: 101,
        },
        {
          address: mockEvmConfig.l1BitcoinDepositorAddress,
          topics: [EVM_TOKENS_TRANSFERRED_SIG],
          data: '0xgooddata',
          transactionHash: '0xsecond-tx',
          blockNumber: 102,
        },
      ]);

      // First parseLog throws, second succeeds
      mockParseLog
        .mockImplementationOnce(() => {
          throw new Error('Failed to decode');
        })
        .mockReturnValueOnce({
          name: 'TokensTransferredWithPayload',
          args: {
            transferSequence: ethers.BigNumber.from(123),
            l2Receiver: '0xowner',
          },
        });

      const result = await (handler as any).searchForTransferSequence(deposit, 100);

      expect(result).toEqual({ sequence: '123', txHash: '0xsecond-tx' });
    });
  });
});
