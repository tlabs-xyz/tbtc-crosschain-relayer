import { ethers } from 'ethers';
import { CHAIN_TYPE, NETWORK } from '../../../config/schemas/common.schema.js';
import {
  type EvmChainConfig,
  EvmChainConfigSchema,
} from '../../../config/schemas/evm.chain.schema.js';
import { RECOVERY_DELAY_MS } from '../../../handlers/BaseChainHandler.js';
import { EVMChainHandler } from '../../../handlers/EVMChainHandler.js';
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

// Compute the correct EVM event signature — EVM ABI uses address (not bytes32) for l2Receiver
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
    (mockDepositsUtil as any).updateToFinalizedAwaitingVAA = jest.fn().mockResolvedValue(undefined);
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
        hashes: { eth: {}, btc: {}, solana: {} },
        wormholeInfo: {
          txHash: null,
          transferSequence: null,
          bridgingAttempted: false,
        },
      } as unknown as Deposit;

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

      // Mock submitFinalizationTx so the handler doesn't hit real infrastructure
      (handler as any).submitFinalizationTx = jest.fn().mockResolvedValue(mockReceipt);

      // Mock the l1BitcoinDepositorProvider interface for parseLog
      // Note: the log address must match config.l1BitcoinDepositorAddress for the filter to pass
      mockReceipt.logs[0].address = mockEvmConfig.l1BitcoinDepositorAddress;

      (handler as any).l1BitcoinDepositorProvider = {
        interface: {
          getEventTopic: jest.fn().mockReturnValue(EVM_TOKENS_TRANSFERRED_SIG),
          parseLog: jest.fn().mockReturnValue({
            name: 'TokensTransferredWithPayload',
            args: { transferSequence: ethers.BigNumber.from(42) },
          }),
        },
      };
    });

    it('should call updateToFinalizedAwaitingVAA with sequence and hashes on success', async () => {
      const result = await handler.finalizeDeposit(mockDeposit);

      expect(result).toBe(mockReceipt);
      expect(mockDepositsUtil.updateToFinalizedAwaitingVAA).toHaveBeenCalledTimes(1);
      expect(mockDepositsUtil.updateToFinalizedAwaitingVAA).toHaveBeenCalledWith(
        mockDeposit,
        mockReceipt.transactionHash,
        '42',
      );
      expect(mockDepositsUtil.updateToFinalizedDeposit).not.toHaveBeenCalled();
    });

    it('should return undefined when submitFinalizationTx returns undefined', async () => {
      (handler as any).submitFinalizationTx = jest.fn().mockResolvedValue(undefined);

      const result = await handler.finalizeDeposit(mockDeposit);

      expect(result).toBeUndefined();
      expect(mockDepositsUtil.updateToFinalizedAwaitingVAA).not.toHaveBeenCalled();
      expect(mockDepositsUtil.updateToFinalizedDeposit).not.toHaveBeenCalled();
    });

    it('should call updateToFinalizedDeposit when transferSequence not found', async () => {
      const receiptWithoutLogs = {
        ...mockReceipt,
        logs: [],
      };
      (handler as any).submitFinalizationTx = jest.fn().mockResolvedValue(receiptWithoutLogs);

      await handler.finalizeDeposit(mockDeposit);

      expect(mockDepositsUtil.updateToFinalizedDeposit).toHaveBeenCalledTimes(1);
      expect(mockDepositsUtil.updateToFinalizedDeposit).toHaveBeenCalledWith(
        mockDeposit,
        { hash: receiptWithoutLogs.transactionHash },
        'transferSequence_not_found',
      );
      expect(mockDepositsUtil.updateToFinalizedAwaitingVAA).not.toHaveBeenCalled();
    });

    it('should return early when deposit status is FINALIZED', async () => {
      mockDeposit = { ...mockDeposit, status: DepositStatus.FINALIZED } as Deposit;

      await handler.finalizeDeposit(mockDeposit);

      expect((handler as any).submitFinalizationTx).not.toHaveBeenCalled();
    });

    it('should return early when deposit status is not INITIALIZED', async () => {
      mockDeposit = { ...mockDeposit, status: DepositStatus.AWAITING_WORMHOLE_VAA } as Deposit;

      await handler.finalizeDeposit(mockDeposit);

      expect((handler as any).submitFinalizationTx).not.toHaveBeenCalled();
    });

    it('should convert transferSequence BigNumber to string', async () => {
      mockReceipt.logs[0].address = mockEvmConfig.l1BitcoinDepositorAddress;
      (handler as any).l1BitcoinDepositorProvider = {
        interface: {
          getEventTopic: jest.fn().mockReturnValue(EVM_TOKENS_TRANSFERRED_SIG),
          parseLog: jest.fn().mockReturnValue({
            name: 'TokensTransferredWithPayload',
            args: { transferSequence: ethers.BigNumber.from(999999) },
          }),
        },
      };

      await handler.finalizeDeposit(mockDeposit);

      expect(mockDepositsUtil.updateToFinalizedAwaitingVAA).toHaveBeenCalledWith(
        mockDeposit,
        expect.any(String),
        '999999',
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

    it('should skip deposits with receiveTbtc_reverted error tag permanently', async () => {
      const permanentErrorDeposit = {
        id: 'deposit-permanent-error',
        chainId: 'BaseSepolia',
        status: DepositStatus.AWAITING_WORMHOLE_VAA,
        wormholeInfo: {
          txHash: '0xpermanent-error-tx',
          transferSequence: '789',
          bridgingAttempted: true,
        },
        error: 'receiveTbtc_reverted',
        dates: { lastActivityAt: Date.now() - RECOVERY_DELAY_MS - 60_000 },
      } as Deposit;

      mockDepositStore.getByStatus.mockResolvedValue([permanentErrorDeposit]);

      const bridgeSpy = jest.spyOn(handler as any, 'bridgeEvmDeposit').mockResolvedValue(undefined);

      await handler.processWormholeBridging();

      expect(mockDepositStore.getByStatus).toHaveBeenCalledWith(
        DepositStatus.AWAITING_WORMHOLE_VAA,
        'BaseSepolia',
      );
      expect(bridgeSpy).not.toHaveBeenCalled();
    });

    it('should skip deposits with bridging_exception within backoff window', async () => {
      const FIXED_NOW = 1700000000000;
      jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);

      const recentTransientDeposit = {
        id: 'deposit-transient-recent',
        chainId: 'BaseSepolia',
        status: DepositStatus.AWAITING_WORMHOLE_VAA,
        wormholeInfo: {
          txHash: '0xtransient-recent-tx',
          transferSequence: '101',
          bridgingAttempted: true,
        },
        error: 'bridging_exception',
        dates: { lastActivityAt: FIXED_NOW - (RECOVERY_DELAY_MS - 60_000) },
      } as Deposit;

      mockDepositStore.getByStatus.mockResolvedValue([recentTransientDeposit]);

      const bridgeSpy = jest.spyOn(handler as any, 'bridgeEvmDeposit').mockResolvedValue(undefined);

      await handler.processWormholeBridging();

      expect(bridgeSpy).not.toHaveBeenCalled();
    });

    it('should process deposits with bridging_exception after backoff window expires', async () => {
      const FIXED_NOW = 1700000000000;
      jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);

      const expiredTransientDeposit = {
        id: 'deposit-transient-expired',
        chainId: 'BaseSepolia',
        status: DepositStatus.AWAITING_WORMHOLE_VAA,
        wormholeInfo: {
          txHash: '0xtransient-expired-tx',
          transferSequence: '202',
          bridgingAttempted: true,
        },
        error: 'bridging_exception',
        dates: { lastActivityAt: FIXED_NOW - (RECOVERY_DELAY_MS + 60_000) },
      } as Deposit;

      mockDepositStore.getByStatus.mockResolvedValue([expiredTransientDeposit]);

      const bridgeSpy = jest.spyOn(handler as any, 'bridgeEvmDeposit').mockResolvedValue(undefined);

      await handler.processWormholeBridging();

      expect(bridgeSpy).toHaveBeenCalledTimes(1);
      expect(bridgeSpy).toHaveBeenCalledWith(expiredTransientDeposit);
    });

    it('should process deposits without error tags normally', async () => {
      const cleanDeposit = {
        id: 'deposit-no-error',
        chainId: 'BaseSepolia',
        status: DepositStatus.AWAITING_WORMHOLE_VAA,
        wormholeInfo: {
          txHash: '0xclean-tx',
          transferSequence: '303',
          bridgingAttempted: false,
        },
        error: null,
        dates: { lastActivityAt: Date.now() },
      } as Deposit;

      mockDepositStore.getByStatus.mockResolvedValue([cleanDeposit]);

      const bridgeSpy = jest.spyOn(handler as any, 'bridgeEvmDeposit').mockResolvedValue(undefined);

      await handler.processWormholeBridging();

      expect(bridgeSpy).toHaveBeenCalledTimes(1);
      expect(bridgeSpy).toHaveBeenCalledWith(cleanDeposit);
    });

    it('should handle mixed deposits: skip errored, process clean ones', async () => {
      const FIXED_NOW = 1700000000000;
      jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);

      const permanentDeposit = {
        id: 'deposit-mixed-permanent',
        chainId: 'BaseSepolia',
        status: DepositStatus.AWAITING_WORMHOLE_VAA,
        wormholeInfo: {
          txHash: '0xmixed-permanent-tx',
          transferSequence: '401',
          bridgingAttempted: true,
        },
        error: 'receiveTbtc_reverted',
        dates: { lastActivityAt: FIXED_NOW - RECOVERY_DELAY_MS - 60_000 },
      } as Deposit;

      const recentTransientDeposit = {
        id: 'deposit-mixed-transient',
        chainId: 'BaseSepolia',
        status: DepositStatus.AWAITING_WORMHOLE_VAA,
        wormholeInfo: {
          txHash: '0xmixed-transient-tx',
          transferSequence: '402',
          bridgingAttempted: true,
        },
        error: 'bridging_exception',
        dates: { lastActivityAt: FIXED_NOW - 60_000 },
      } as Deposit;

      const cleanDeposit = {
        id: 'deposit-mixed-clean',
        chainId: 'BaseSepolia',
        status: DepositStatus.AWAITING_WORMHOLE_VAA,
        wormholeInfo: {
          txHash: '0xmixed-clean-tx',
          transferSequence: '403',
          bridgingAttempted: false,
        },
        error: null,
        dates: { lastActivityAt: FIXED_NOW },
      } as Deposit;

      mockDepositStore.getByStatus.mockResolvedValue([
        permanentDeposit,
        recentTransientDeposit,
        cleanDeposit,
      ]);

      const bridgeSpy = jest.spyOn(handler as any, 'bridgeEvmDeposit').mockResolvedValue(undefined);

      await handler.processWormholeBridging();

      expect(bridgeSpy).toHaveBeenCalledTimes(1);
      expect(bridgeSpy).toHaveBeenCalledWith(cleanDeposit);
    });

    it('should process bridging_exception deposit at exact backoff boundary', async () => {
      const FIXED_NOW = 1700000000000;
      jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);

      const boundaryDeposit = {
        id: 'deposit-boundary',
        chainId: 'BaseSepolia',
        status: DepositStatus.AWAITING_WORMHOLE_VAA,
        wormholeInfo: {
          txHash: '0xboundary-tx',
          transferSequence: '501',
          bridgingAttempted: true,
        },
        error: 'bridging_exception',
        dates: { lastActivityAt: FIXED_NOW - RECOVERY_DELAY_MS },
      } as Deposit;

      mockDepositStore.getByStatus.mockResolvedValue([boundaryDeposit]);

      const bridgeSpy = jest.spyOn(handler as any, 'bridgeEvmDeposit').mockResolvedValue(undefined);

      await handler.processWormholeBridging();

      expect(bridgeSpy).toHaveBeenCalledTimes(1);
      expect(bridgeSpy).toHaveBeenCalledWith(boundaryDeposit);
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
        headers: { get: () => null },
        text: () => Promise.resolve(JSON.stringify({ data: { vaa: 'dGVzdHZhYQ==' } })),
      });
      global.fetch = mockFetch;

      const expectedEmitter = 'db5492265f6038831e89f495670ff909ade94bd9'.padStart(64, '0');

      const resultPromise = realFetchVAA('456', NETWORK.TESTNET);
      await jest.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api.testnet.wormholescan.io'),
        expect.objectContaining({ signal: expect.anything() }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/10002/${expectedEmitter}/456`),
        expect.objectContaining({ signal: expect.anything() }),
      );
      expect(result).toBe('dGVzdHZhYQ==');
    });

    it('should construct correct Wormhole API URL for mainnet', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => null },
        text: () => Promise.resolve(JSON.stringify({ data: { vaa: 'mainnetvaa' } })),
      });
      global.fetch = mockFetch;

      const resultPromise = realFetchVAA('123', NETWORK.MAINNET);
      await jest.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api.wormholescan.io'),
        expect.objectContaining({ signal: expect.anything() }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.not.stringContaining('testnet'),
        expect.objectContaining({ signal: expect.anything() }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/2/'),
        expect.objectContaining({ signal: expect.anything() }),
      );
      expect(result).toBe('mainnetvaa');
    });

    it('should return base64 VAA on successful response', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => null },
        text: () => Promise.resolve(JSON.stringify({ data: { vaa: 'base64vaastring' } })),
      });
      global.fetch = mockFetch;

      const resultPromise = realFetchVAA('789', NETWORK.TESTNET);
      await jest.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;

      expect(result).toBe('base64vaastring');
    });

    it('should return null on 404 response (single attempt, no retry)', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
      global.fetch = mockFetch;

      const result = await realFetchVAA('100', NETWORK.TESTNET);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).toBeNull();
    });

    it('should return null when VAA field is missing in response', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => null },
        text: () => Promise.resolve(JSON.stringify({ data: {} })),
      });
      global.fetch = mockFetch;

      const result = await realFetchVAA('999', NETWORK.TESTNET);

      expect(result).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should return null on network error (single attempt, no retry)', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('Network error'));
      global.fetch = mockFetch;

      const result = await realFetchVAA('200', NETWORK.TESTNET);

      expect(result).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should use correct Token Bridge emitter address for mainnet', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => null },
        text: () => Promise.resolve(JSON.stringify({ data: { vaa: 'vaa' } })),
      });
      global.fetch = mockFetch;

      const expectedMainnetEmitter =
        '0000000000000000000000003ee18b2214aff97000d974cf647e7c347e8fa585';

      const resultPromise = realFetchVAA('300', NETWORK.MAINNET);
      await jest.advanceTimersByTimeAsync(1000);
      await resultPromise;

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(expectedMainnetEmitter),
        expect.objectContaining({ signal: expect.anything() }),
      );
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
        status: 1,
      });
      mockReceiveTbtc = jest.fn().mockResolvedValue({ wait: mockWait });

      (handler as any).l2WormholeGateway = {
        receiveTbtc: mockReceiveTbtc,
      };

      // Mock shared fetchVAAFromAPI to return a valid base64 VAA long enough to pass
      // the length check (>= 200 hex chars = >= 100 bytes).
      // 100 null bytes in base64: 132 'A's (99 bytes) + 'AA==' (1 byte) = 100 bytes total.
      const MOCK_VAA_BASE64 = 'A'.repeat(132) + 'AA==';
      (wormholeVAAModule.fetchVAAFromAPI as jest.Mock).mockResolvedValue(MOCK_VAA_BASE64);
    });

    it('should call receiveTbtc with hex-encoded VAA bytes', async () => {
      await handler.bridgeEvmDeposit(mockDeposit);

      // 100 null bytes -> hex '0x' + '00'.repeat(100)
      expect(mockReceiveTbtc).toHaveBeenCalledWith('0x' + '00'.repeat(100));
    });

    it('should call updateToBridgedDeposit on successful transaction', async () => {
      await handler.bridgeEvmDeposit(mockDeposit);

      expect(mockDepositsUtil.updateToBridgedDeposit).toHaveBeenCalledWith(
        mockDeposit,
        '0xreceipt-tx-hash',
        CHAIN_TYPE.EVM,
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

  describe('processFinalizeDeposits', () => {
    let mockDeposit: Deposit;

    beforeEach(() => {
      mockDeposit = {
        id: 'test-finalize-deposit',
        chainId: 'BaseSepolia',
        status: DepositStatus.INITIALIZED,
        hashes: { eth: {}, btc: {}, solana: {} },
        dates: { lastActivityAt: 0, createdAt: Date.now() - 600000 },
        wormholeInfo: { txHash: null, transferSequence: null, bridgingAttempted: false },
      } as unknown as Deposit;

      mockDepositStore.getByStatus.mockResolvedValue([mockDeposit]);
      (mockDepositsUtil as any).updateLastActivity = jest.fn().mockResolvedValue(mockDeposit);
      jest.spyOn(handler as any, 'checkDepositStatus').mockResolvedValue(DepositStatus.FINALIZED);
      jest
        .spyOn(handler as any, 'filterDepositsActivityTime')
        .mockImplementation((deposits: any) => deposits);
    });

    it('should call updateToFinalizedDeposit with correct arguments when L1 status is FINALIZED', async () => {
      (mockDepositsUtil as any).updateToFinalizedDeposit = jest.fn().mockResolvedValue(undefined);

      await handler.processFinalizeDeposits();

      expect(mockDepositsUtil.updateToFinalizedDeposit).toHaveBeenCalledTimes(1);
      expect(mockDepositsUtil.updateToFinalizedDeposit).toHaveBeenCalledWith(
        mockDeposit,
        undefined,
        'Deposit found finalized on L1',
      );
    });

    it('should await updateToFinalizedDeposit ensuring sequential execution within the deposit loop', async () => {
      // Verify that processFinalizeDeposits awaits updateToFinalizedDeposit
      // by tracking execution order. If awaited, the mock completes before
      // processFinalizeDeposits returns. If fire-and-forget, the ordering is
      // non-deterministic and the mock may resolve after the caller returns.
      const executionOrder: string[] = [];

      (mockDepositsUtil as any).updateToFinalizedDeposit = jest
        .fn()
        .mockImplementation(async () => {
          // Simulate an async DB operation that takes a microtask tick
          await new Promise((resolve) => setTimeout(resolve, 10));
          executionOrder.push('updateToFinalizedDeposit_resolved');
        });

      await handler.processFinalizeDeposits();
      executionOrder.push('processFinalizeDeposits_returned');

      // If updateToFinalizedDeposit is properly awaited, its resolution marker
      // appears BEFORE the caller returns. If fire-and-forget, the caller
      // returns first and the deferred resolution runs after.
      expect(executionOrder[0]).toBe('updateToFinalizedDeposit_resolved');
      expect(executionOrder[1]).toBe('processFinalizeDeposits_returned');
    });

    it('should propagate database errors from updateToFinalizedDeposit when L1 status is FINALIZED', async () => {
      // When updateToFinalizedDeposit rejects (e.g. DB failure), the error must
      // propagate to the caller. Without await, the rejection would be an
      // unhandled promise rejection and processFinalizeDeposits would resolve
      // successfully, silently swallowing the error.
      const dbError = new Error('Database connection lost');
      (mockDepositsUtil as any).updateToFinalizedDeposit = jest.fn().mockRejectedValue(dbError);

      await expect(handler.processFinalizeDeposits()).rejects.toThrow('Database connection lost');
    });
  });
});
