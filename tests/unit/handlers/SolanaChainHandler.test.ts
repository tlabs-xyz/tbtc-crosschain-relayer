import * as Sentry from '@sentry/node';
import { CHAIN_TYPE, NETWORK } from '../../../config/schemas/common.schema.js';
import type { SolanaChainConfig } from '../../../config/schemas/solana.chain.schema.js';
import { RECOVERY_DELAY_MS } from '../../../handlers/BaseChainHandler.js';
import { SolanaChainHandler } from '../../../handlers/SolanaChainHandler.js';
import type { Deposit } from '../../../types/Deposit.type.js';
import { DepositStatus } from '../../../types/DepositStatus.enum.js';
import { DepositStore } from '../../../utils/DepositStore.js';
import * as depositUtils from '../../../utils/Deposits.js';
import logger from '../../../utils/Logger.js';

// Mock external dependencies
jest.mock('../../../utils/DepositStore');
jest.mock('../../../utils/Logger');
jest.mock('../../../utils/Deposits');
jest.mock('../../../utils/AuditLog');
jest.mock('@sentry/node');

// Mock the config module to prevent loading all chain configurations during unit tests
jest.mock('../../../config/index.js', () => ({
  chainConfigs: {},
  getAvailableChainKeys: () => ['solanaDevnet'],
}));

// Mock Wormhole SDK
jest.mock('@wormhole-foundation/sdk', () => ({
  Wormhole: {
    parseAddress: jest.fn().mockReturnValue('mock-address'),
  },
  signSendWait: jest.fn(),
}));

jest.mock('@wormhole-foundation/sdk-solana', () => ({
  getSolanaSignAndSendSigner: jest.fn().mockResolvedValue({
    chain: jest.fn().mockReturnValue('Solana'),
    address: jest.fn().mockReturnValue('mock-solana-address'),
  }),
}));

jest.mock('@wormhole-foundation/sdk-connect', () => ({}));

// Mock Anchor / Solana SDK dependencies
jest.mock('@coral-xyz/anchor', () => ({
  AnchorProvider: jest.fn().mockImplementation(() => ({})),
  Program: jest.fn().mockImplementation(() => ({})),
  Wallet: jest.fn().mockImplementation(() => ({})),
  setProvider: jest.fn(),
}));

jest.mock('@coral-xyz/anchor/dist/cjs/utils/bytes/index.js', () => ({
  bs58: {
    decode: jest.fn().mockReturnValue(new Uint8Array(64)),
  },
}));

jest.mock('@solana/web3.js', () => ({
  Connection: jest.fn().mockImplementation(() => ({
    getSlot: jest.fn().mockResolvedValue(12345),
  })),
  Keypair: {
    fromSecretKey: jest.fn().mockReturnValue({
      publicKey: { toBase58: jest.fn().mockReturnValue('mock-pubkey') },
    }),
  },
  PublicKey: jest.fn().mockImplementation((val: string) => ({
    toString: () => val,
    toBase58: () => val,
  })),
}));

// Mock the Wormhole Gateway IDL import (JSON import attribute not supported in Jest)
jest.mock('../../../target/idl/wormhole_gateway.json', () => ({}), { virtual: true });

// Construct a mock Solana config, cast to avoid strict schema validation (base58 regex)
const mockSolanaConfig = {
  chainName: 'SolanaDevnet',
  network: NETWORK.TESTNET,
  chainType: CHAIN_TYPE.SOLANA,
  l1Rpc: 'http://l1-rpc.test',
  l2Rpc: 'http://l2-rpc.test',
  l2WsRpc: 'wss://l2-ws.test',
  l1BitcoinDepositorAddress: '0x1234567890123456789012345678901234567890',
  l2BitcoinDepositorAddress: 'SoLaNaBiTcOiNdEpOsItOrAdDrEsSmOcK1234567890',
  vaultAddress: '0xaabbccddaabbccddaabbccddaabbccddaabbccdd',
  l1BitcoinDepositorStartBlock: 0,
  l2BitcoinDepositorStartBlock: 0,
  l1Confirmations: 1,
  useEndpoint: false,
  enableL2Redemption: false,
  solanaPrivateKey: 'A'.repeat(88),
  solanaCommitment: 'confirmed',
  solanaSignerKeyBase: 'mock-signer-key-base',
  l2WormholeGatewayAddress: 'SoLaNaWoRmHoLeGaTeWaYaDdReSs1234567890mock',
  l2WormholeChainId: 1,
} as unknown as SolanaChainConfig;

describe('SolanaChainHandler', () => {
  let handler: SolanaChainHandler;
  let mockDepositStore: jest.Mocked<typeof DepositStore>;
  let mockDepositsUtil: jest.Mocked<typeof depositUtils>;

  // Mock wormhole object matching EVM/SUI test patterns
  const mockWormhole = {
    getChain: jest.fn().mockReturnValue({
      parseTransaction: jest.fn().mockResolvedValue([
        {
          chain: 'Ethereum',
          emitter: '0x123',
          sequence: BigInt(1),
        },
      ]),
      getTBTCBridge: jest.fn().mockResolvedValue({
        redeem: jest.fn().mockReturnValue([]),
      }),
    }),
    getVaa: jest.fn().mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3, 4]),
    }),
  };

  // Mock Solana internal objects
  const mockConnection = { getSlot: jest.fn().mockResolvedValue(12345) };
  const mockProvider = {};
  const mockWallet = {};
  const mockGatewayProgram = {};
  const mockEthereumContext = {
    parseTransaction: jest.fn().mockResolvedValue([
      {
        chain: 'Ethereum',
        emitter: '0x123',
        sequence: BigInt(1),
      },
    ]),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockDepositStore = DepositStore as jest.Mocked<typeof DepositStore>;
    mockDepositsUtil = depositUtils as jest.Mocked<typeof depositUtils>;

    // Setup default mock implementations
    mockDepositStore.getById = jest.fn().mockResolvedValue(null);
    mockDepositStore.getByStatus = jest.fn().mockResolvedValue([]);
    mockDepositStore.create = jest.fn().mockResolvedValue(undefined);
    mockDepositStore.update = jest.fn().mockResolvedValue(undefined);
    (mockDepositsUtil as any).updateToFinalizedAwaitingVAA = jest.fn().mockResolvedValue(undefined);
    (mockDepositsUtil as any).updateToBridgedDeposit = jest.fn().mockResolvedValue(undefined);
    (mockDepositsUtil as any).updateToAwaitingWormholeVAA = jest.fn().mockResolvedValue(undefined);

    // Create handler instance
    handler = new SolanaChainHandler(mockSolanaConfig);

    // Set internal properties directly (bypass initializeL2)
    (handler as any).wormhole = mockWormhole;
    (handler as any).connection = mockConnection;
    (handler as any).provider = mockProvider;
    (handler as any).wallet = mockWallet;
    (handler as any).wormholeGatewayProgram = mockGatewayProgram;
    (handler as any).ethereumWormholeContext = mockEthereumContext;
  });

  describe('bridgeSolanaDeposit', () => {
    it('should return early when deposit status is not AWAITING_WORMHOLE_VAA', async () => {
      const deposit = {
        id: 'test-solana-deposit-wrong-status',
        status: DepositStatus.INITIALIZED,
        wormholeInfo: {
          txHash: '0xtest-tx-hash',
          transferSequence: '123',
          bridgingAttempted: false,
        },
      } as unknown as Deposit;

      await handler.bridgeSolanaDeposit(deposit);

      expect(mockEthereumContext.parseTransaction).not.toHaveBeenCalled();
      expect(mockWormhole.getVaa).not.toHaveBeenCalled();
    });

    it('should return early when Solana connection is not initialized', async () => {
      (handler as any).connection = undefined;
      (handler as any).provider = undefined;
      (handler as any).wallet = undefined;

      const deposit = {
        id: 'test-solana-deposit-no-conn',
        status: DepositStatus.AWAITING_WORMHOLE_VAA,
        wormholeInfo: {
          txHash: '0xtest-tx-hash',
          transferSequence: '123',
          bridgingAttempted: false,
        },
      } as unknown as Deposit;

      await handler.bridgeSolanaDeposit(deposit);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Solana connection not initialized'),
      );
      expect(mockEthereumContext.parseTransaction).not.toHaveBeenCalled();
    });

    it('should return early when Wormhole Gateway program is not initialized', async () => {
      (handler as any).wormholeGatewayProgram = undefined;

      const deposit = {
        id: 'test-solana-deposit-no-gateway',
        status: DepositStatus.AWAITING_WORMHOLE_VAA,
        wormholeInfo: {
          txHash: '0xtest-tx-hash',
          transferSequence: '123',
          bridgingAttempted: false,
        },
      } as unknown as Deposit;

      await handler.bridgeSolanaDeposit(deposit);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Wormhole Gateway program not initialized'),
      );
      expect(mockEthereumContext.parseTransaction).not.toHaveBeenCalled();
    });

    describe('error persistence', () => {
      const FIXED_NOW = 1700000000000;
      let dateNowSpy: jest.SpyInstance;
      let fullMockDeposit: Deposit;

      beforeEach(() => {
        dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);

        fullMockDeposit = {
          id: 'error-persist-solana-deposit-id',
          chainId: 'SolanaDevnet',
          status: DepositStatus.AWAITING_WORMHOLE_VAA,
          fundingTxHash: 'mock-funding-tx-hash',
          outputIndex: 0,
          hashes: {
            btc: { btcTxHash: null },
            eth: { initializeTxHash: null, finalizeTxHash: null },
            solana: { bridgeTxHash: null },
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
              fundingOutputIndex: 0,
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

      it('should tag deposit with bridging_exception on transient failure', async () => {
        // parseTransaction succeeds (outside try block), but getVaa rejects
        // inside the try block with a transient network error
        mockWormhole.getVaa.mockRejectedValueOnce(new Error('Network timeout'));

        await handler.bridgeSolanaDeposit(fullMockDeposit);

        expect(mockDepositStore.update).toHaveBeenCalledTimes(1);
        const updatedDeposit = mockDepositStore.update.mock.calls[0][0];
        expect(updatedDeposit.error).toBe('bridging_exception');
        expect(updatedDeposit.dates.lastActivityAt).toBe(FIXED_NOW);
        expect(updatedDeposit.id).toBe('error-persist-solana-deposit-id');
        expect(mockDepositsUtil.updateToBridgedDeposit).not.toHaveBeenCalled();
      });

      it('should tag deposit with receiveTbtc_reverted on permanent failure', async () => {
        // parseTransaction succeeds (outside try block), but getVaa rejects
        // inside the try block with a permanent on-chain revert error.
        // Uses "Transaction failed:" prefix following the SUI handler pattern.
        mockWormhole.getVaa.mockRejectedValueOnce(
          new Error('Transaction failed: custom program error 0x1'),
        );

        await handler.bridgeSolanaDeposit(fullMockDeposit);

        expect(mockDepositStore.update).toHaveBeenCalledTimes(1);
        const updatedDeposit = mockDepositStore.update.mock.calls[0][0];
        expect(updatedDeposit.error).toBe('receiveTbtc_reverted');
        expect(updatedDeposit.dates.lastActivityAt).toBe(FIXED_NOW);
        expect(updatedDeposit.id).toBe('error-persist-solana-deposit-id');
        expect(mockDepositsUtil.updateToBridgedDeposit).not.toHaveBeenCalled();
      });

      it('should update lastActivityAt to current timestamp on every error', async () => {
        // Confirm the original lastActivityAt is different from FIXED_NOW
        expect(fullMockDeposit.dates.lastActivityAt).toBe(1699000300000);
        expect(fullMockDeposit.dates.lastActivityAt).not.toBe(FIXED_NOW);

        // parseTransaction succeeds, getVaa rejects inside try block
        mockWormhole.getVaa.mockRejectedValueOnce(new Error('RPC unavailable'));

        await handler.bridgeSolanaDeposit(fullMockDeposit);

        expect(mockDepositStore.update).toHaveBeenCalledTimes(1);
        const updatedDeposit = mockDepositStore.update.mock.calls[0][0];
        expect(updatedDeposit.dates.lastActivityAt).toBe(FIXED_NOW);
        expect(updatedDeposit.dates.lastActivityAt).not.toBe(fullMockDeposit.dates.lastActivityAt);
      });

      it('should preserve all original deposit fields when persisting error', async () => {
        // parseTransaction succeeds, getVaa rejects inside try block
        mockWormhole.getVaa.mockRejectedValueOnce(new Error('RPC unavailable'));

        await handler.bridgeSolanaDeposit(fullMockDeposit);

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

  describe('processWormholeBridging', () => {
    it('should query deposits with AWAITING_WORMHOLE_VAA status for this chain', async () => {
      mockDepositStore.getByStatus.mockResolvedValueOnce([]);

      await handler.processWormholeBridging();

      expect(mockDepositStore.getByStatus).toHaveBeenCalledWith(
        DepositStatus.AWAITING_WORMHOLE_VAA,
        'SolanaDevnet',
      );
    });

    it('should return early when no deposits are awaiting bridging', async () => {
      mockDepositStore.getByStatus.mockResolvedValueOnce([]);

      const bridgeSpy = jest.spyOn(handler, 'bridgeSolanaDeposit');

      await handler.processWormholeBridging();

      expect(bridgeSpy).not.toHaveBeenCalled();
      bridgeSpy.mockRestore();
    });

    it('should skip deposits without transferSequence', async () => {
      const depositNoSequence = {
        id: 'deposit-no-sequence',
        wormholeInfo: {
          txHash: '0xtest-tx-hash',
          transferSequence: null,
          bridgingAttempted: false,
        },
      } as unknown as Deposit;

      mockDepositStore.getByStatus.mockResolvedValueOnce([depositNoSequence]);

      const bridgeSpy = jest.spyOn(handler, 'bridgeSolanaDeposit');

      await handler.processWormholeBridging();

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('missing transferSequence'));
      expect(bridgeSpy).not.toHaveBeenCalled();
      bridgeSpy.mockRestore();
    });
  });

  describe('recoverStuckFinalizedDeposits', () => {
    const FIXED_NOW = 1700000000000;
    let dateNowSpy: jest.SpyInstance;

    const makeDeposit = (overrides: Partial<Deposit> = {}): Deposit => ({
      id: 'recovery-solana-deposit-id',
      chainId: 'SolanaDevnet',
      status: DepositStatus.AWAITING_WORMHOLE_VAA,
      fundingTxHash: 'mock-funding-tx-hash',
      outputIndex: 0,
      hashes: {
        btc: { btcTxHash: null },
        eth: { initializeTxHash: null, finalizeTxHash: null },
        solana: { bridgeTxHash: null },
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
          fundingOutputIndex: 0,
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

      const bridgeSpy = jest.spyOn(handler, 'bridgeSolanaDeposit').mockResolvedValue(undefined);

      await (handler as any).recoverStuckFinalizedDeposits();

      expect(mockDepositStore.getByStatus).toHaveBeenCalledWith(
        DepositStatus.AWAITING_WORMHOLE_VAA,
        'SolanaDevnet',
      );
      expect(bridgeSpy).toHaveBeenCalledTimes(1);
      expect(bridgeSpy).toHaveBeenCalledWith(stuckDeposit);
      bridgeSpy.mockRestore();
    });

    it('should skip deposits with receiveTbtc_reverted error', async () => {
      const permanentDeposit = makeDeposit({ error: 'receiveTbtc_reverted' });
      mockDepositStore.getByStatus
        .mockResolvedValueOnce([permanentDeposit])
        .mockResolvedValueOnce([]);

      const bridgeSpy = jest.spyOn(handler, 'bridgeSolanaDeposit').mockResolvedValue(undefined);

      await (handler as any).recoverStuckFinalizedDeposits();

      expect(bridgeSpy).not.toHaveBeenCalled();
      bridgeSpy.mockRestore();
    });

    it('should skip deposits within RECOVERY_DELAY_MS window', async () => {
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

      const bridgeSpy = jest.spyOn(handler, 'bridgeSolanaDeposit').mockResolvedValue(undefined);

      await (handler as any).recoverStuckFinalizedDeposits();

      expect(bridgeSpy).not.toHaveBeenCalled();
      bridgeSpy.mockRestore();
    });

    it('should handle bridgeSolanaDeposit errors without throwing', async () => {
      const stuckDeposit = makeDeposit();
      mockDepositStore.getByStatus.mockResolvedValueOnce([stuckDeposit]).mockResolvedValueOnce([]);

      const bridgeSpy = jest
        .spyOn(handler, 'bridgeSolanaDeposit')
        .mockRejectedValueOnce(new Error('Bridge failed'));

      await expect((handler as any).recoverStuckFinalizedDeposits()).resolves.toBeUndefined();

      expect(bridgeSpy).toHaveBeenCalledTimes(1);
      bridgeSpy.mockRestore();
    });

    it('should alert on FINALIZED deposits with transferSequence_not_found', async () => {
      const finalizedDeposit = makeDeposit({
        id: 'finalized-stuck-solana-deposit',
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
          message: expect.stringContaining('finalized-stuck-solana-deposit'),
        }),
        expect.objectContaining({
          extra: expect.objectContaining({
            depositId: 'finalized-stuck-solana-deposit',
            chainName: 'SolanaDevnet',
          }),
        }),
      );

      expect(mockDepositStore.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'finalized-stuck-solana-deposit',
          error: 'transferSequence_not_found_alerted',
        }),
      );
    });
  });
});
