import { SeiChainHandler } from '../../../handlers/SeiChainHandler.js';
import { SeiChainConfigSchema, type SeiChainConfig } from '../../../config/schemas/sei.chain.schema.js';
import { CHAIN_TYPE, NETWORK } from '../../../config/schemas/common.schema.js';
import { DepositStore } from '../../../utils/DepositStore.js';
import logger from '../../../utils/Logger.js';
import { DepositStatus } from '../../../types/DepositStatus.enum.js';
import type { Deposit } from '../../../types/Deposit.type.js';
import type { Reveal } from '../../../types/Reveal.type.js';
import * as depositUtils from '../../../utils/Deposits.js';
import * as getTransactionHashUtils from '../../../utils/GetTransactionHash.js';
import * as auditLog from '../../../utils/AuditLog.js';
import { Contract as EthersContract, ethers } from 'ethers';
import { type FundingTransaction } from '../../../types/FundingTransaction.type.js';

// Mock external dependencies
jest.mock('../../../utils/DepositStore');
jest.mock('../../../utils/Logger');
jest.mock('../../../utils/Deposits');
jest.mock('../../../utils/GetTransactionHash.js');
jest.mock('../../../utils/AuditLog');

// Mock the config module to prevent loading all chain configurations during unit tests
jest.mock('../../../config/index.js', () => ({
  chainConfigs: {},
  getAvailableChainKeys: () => ['seiMainnet'],
}));

// Mock ethers.Contract instances and provider methods
const mockContractInstance = {
  initializeDeposit: jest.fn(),
  finalizeDeposit: jest.fn(),
  filters: {
    TokensTransferredNttWithExecutor: jest.fn(() => ({})),
    DepositInitialized: jest.fn(() => ({})),
    OptimisticMintingFinalized: jest.fn(() => ({})),
  },
  on: jest.fn(),
  queryFilter: jest.fn(),
  callStatic: {
    initializeDeposit: jest.fn(),
    finalizeDeposit: jest.fn(),
  },
  address: '0xMockContractAddress',
  deposits: jest.fn().mockResolvedValue(ethers.BigNumber.from(0)),
  estimateGas: {
    initializeDeposit: jest.fn().mockResolvedValue(ethers.BigNumber.from(200000)),
    finalizeDeposit: jest.fn().mockResolvedValue(ethers.BigNumber.from(200000)),
  },
};

const mockGetTransactionReceiptImplementation = jest.fn();

// Default config for tests
const mockSeiConfig: SeiChainConfig = SeiChainConfigSchema.parse({
  chainName: 'SeiMainnet',
  network: NETWORK.MAINNET,
  l1Confirmations: 3,
  l1Rpc: 'http://l1-rpc.test',
  l2Rpc: 'http://sei-rpc.test',
  l1BitcoinDepositorAddress: '0xd2d9c936165a85f27a5a7e07afb974d022b89463',
  vaultAddress: '0xabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcde',
  l1BitcoinRedeemerAddress: '0x11223344556677889900aabbccddeeff11223344',
  l1BitcoinDepositorStartBlock: 1,
  chainType: CHAIN_TYPE.SEI,
  privateKey: '0x123456789012345678901234567890123456789012345678901234567890abcd',
  l2TokenAddress: '0xF9201c9192249066Aec049ae7951ae298BBec767',
  wormholeChainId: 40,
});

describe('SeiChainHandler', () => {
  let handler: SeiChainHandler;
  let mockDepositStore: jest.Mocked<typeof DepositStore>;
  let mockDepositsUtil: jest.Mocked<typeof depositUtils>;
  let mockGetTransactionHashUtil: jest.Mocked<typeof getTransactionHashUtils>;
  let mockAuditLogUtil: jest.Mocked<typeof auditLog>;
  let mockDepositForFinalize: any;

  const mockWalletImpl = (privateKey: string, provider: any) => {
    if (typeof privateKey !== 'string' || !privateKey.startsWith('0x')) {
      // Validate privateKey format in tests
    }
    return {
      _isSigner: true,
      privateKey,
      provider,
      getAddress: jest.fn().mockResolvedValue('0xMockedWalletAddress'),
      signMessage: jest.fn().mockResolvedValue('mock_signed_message'),
      signTransaction: jest.fn().mockResolvedValue('mock_signed_transaction'),
      connect: jest.fn(function (this: any, p) {
        this.provider = p;
        return this;
      }),
      getChainId: jest.fn().mockResolvedValue(1329),
      getGasPrice: jest.fn().mockResolvedValue(ethers.BigNumber.from('10000000000')),
      estimateGas: jest.fn().mockResolvedValue(ethers.BigNumber.from('21000')),
      call: jest.fn().mockResolvedValue('0x'),
      getTransactionCount: jest.fn().mockResolvedValue(0),
      getBalance: jest.fn().mockResolvedValue(ethers.utils.parseEther('10')),
    };
  };

  const mockJsonRpcProviderImpl = (_url: string | any) => {
    const network = { chainId: 1, name: 'mocked-network' };
    return {
      getTransactionReceipt: mockGetTransactionReceiptImplementation,
      getNetwork: jest.fn().mockResolvedValue(network),
      network: network,
      _network: network,
      resolveName: jest.fn((name) => Promise.resolve(name)),
      getGasPrice: jest.fn().mockResolvedValue(ethers.BigNumber.from('10000000000')),
      getBlockNumber: jest.fn().mockResolvedValue(12345),
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();

    jest.spyOn(ethers, 'Wallet').mockImplementation(mockWalletImpl as any);
    jest.spyOn(ethers, 'Contract').mockImplementation(() => {
      return {
        ...mockContractInstance,
        provider: mockJsonRpcProviderImpl('http://l1-rpc.test'),
        signer: mockWalletImpl(mockSeiConfig.privateKey || '', mockJsonRpcProviderImpl('http://l1-rpc.test')),
        connect: jest.fn().mockReturnThis(),
      } as unknown as ethers.Contract;
    });
    jest.spyOn(ethers.providers, 'JsonRpcProvider').mockImplementation(mockJsonRpcProviderImpl as any);

    mockGetTransactionReceiptImplementation.mockResolvedValue({ blockNumber: 100 });

    mockDepositStore = DepositStore as jest.Mocked<typeof DepositStore>;
    mockDepositsUtil = depositUtils as jest.Mocked<typeof depositUtils>;
    mockGetTransactionHashUtil = getTransactionHashUtils as jest.Mocked<typeof getTransactionHashUtils>;
    mockAuditLogUtil = auditLog as jest.Mocked<typeof auditLog>;

    mockGetTransactionHashUtil.getFundingTxHash.mockReturnValue('0xfundingtxhash');
    mockDepositsUtil.getDepositId.mockImplementation((hash, index) => `deposit-${hash}-${index}`);
    mockDepositsUtil.createDeposit.mockImplementation((ftx, rev, owner, sender, chainId) => {
      const fundingTxHash = mockGetTransactionHashUtil.getFundingTxHash(ftx as any);
      const outputIndex = (rev as Reveal).fundingOutputIndex;
      const currentDepositId = mockDepositsUtil.getDepositId(fundingTxHash, outputIndex);
      return {
        id: currentDepositId,
        chainId,
        owner: owner as string,
        status: DepositStatus.QUEUED,
        L1OutputEvent: {
          fundingTx: ftx as FundingTransaction,
          reveal: rev as Reveal,
          l2DepositOwner: owner as string,
          l2Sender: sender as string,
        },
        hashes: {
          eth: { initializeTxHash: null, finalizeTxHash: null },
          btc: { btcTxHash: fundingTxHash },
          sei: { l1BridgeTxHash: null, wormholeSequence: null },
          solana: { bridgeTxHash: null },
        },
        dates: {
          createdAt: Date.now(),
          initializationAt: null,
          finalizationAt: null,
          lastActivityAt: Date.now(),
          awaitingWormholeVAAMessageSince: null,
          bridgedAt: null,
        },
        receipt: {
          depositor: sender as string,
          blindingFactor: (rev as Reveal).blindingFactor,
          walletPublicKeyHash: (rev as Reveal).walletPubKeyHash,
          refundPublicKeyHash: (rev as Reveal).refundPubKeyHash,
          refundLocktime: (rev as Reveal).refundLocktime,
          extraData: owner as string,
        },
        wormholeInfo: {
          txHash: null,
          transferSequence: null,
          bridgingAttempted: false,
        },
        error: null,
      } as unknown as Deposit;
    });

    mockContractInstance.callStatic.initializeDeposit.mockResolvedValue(undefined);
    mockContractInstance.callStatic.finalizeDeposit.mockResolvedValue(undefined);

    mockContractInstance.initializeDeposit.mockResolvedValue({
      hash: '0xInitTxHash',
      wait: jest.fn().mockResolvedValue({ status: 1, transactionHash: '0xInitTxHash', blockNumber: 123 }),
    });
    mockContractInstance.finalizeDeposit.mockResolvedValue({
      hash: '0xFinalizeTxHash',
      wait: jest.fn().mockResolvedValue({ status: 1, transactionHash: '0xFinalizeTxHash', blockNumber: 456 }),
    });

    handler = new SeiChainHandler(mockSeiConfig);
    (handler as any).l1Provider = new ethers.providers.JsonRpcProvider(mockSeiConfig.l1Rpc);
    (handler as any).l1Signer = new ethers.Wallet(mockSeiConfig.privateKey!, (handler as any).l1Provider);
    (handler as any).l1Signer.getBalance = jest.fn().mockResolvedValue(ethers.utils.parseEther('10'));

    (handler as any).nonceManagerL1 = new (jest.requireActual('@ethersproject/experimental').NonceManager)((handler as any).l1Signer);
    (handler as any).tbtcVaultProvider = new ethers.Contract('0xVaultAddress', [], (handler as any).l1Provider);

    (handler as any).l1DepositorContract = mockContractInstance;
    (handler as any).l1DepositorContractProvider = mockContractInstance;
  });

  describe('Constructor and Initialization', () => {
    it('should construct and initialize L1 NTT components successfully with valid config', async () => {
      expect(handler).toBeInstanceOf(SeiChainHandler);
      expect(ethers.Contract).toHaveBeenCalled();
      expect((handler as any).l1DepositorContract).toBeDefined();
      expect((handler as any).l1DepositorContractProvider).toBeDefined();
    });

    it('should throw if L1 RPC is not configured', () => {
      const invalidConfig = {
        ...mockSeiConfig,
        l1Rpc: undefined,
      } as Partial<SeiChainConfig>;
      expect(() => new SeiChainHandler(invalidConfig as SeiChainConfig)).toThrowError(
        'Invalid Sei configuration. Please check logs for details.',
      );
    });

    it('should throw if l1BitcoinDepositorAddress is missing', () => {
      const configWithoutContract = {
        ...mockSeiConfig,
        l1BitcoinDepositorAddress: undefined,
      } as Partial<SeiChainConfig>;
      expect(() => new SeiChainHandler(configWithoutContract as SeiChainConfig)).toThrowError(
        'Invalid Sei configuration. Please check logs for details.',
      );
    });
  });

  describe('initializeDeposit', () => {
    let mockDeposit: Deposit;
    const mockFundingTx: FundingTransaction = {
      version: '1',
      inputVector: '0x010000000000000000000000000000000000000000000000000000000000000000ffffffff0000ffffffff',
      outputVector: '0x0100000000000000001976a914000000000000000000000000000000000000000088ac',
      locktime: '0',
    };
    let revealInstance: Reveal;

    beforeEach(() => {
      revealInstance = {
        fundingOutputIndex: 0,
        blindingFactor: '0xblindingFactorMock',
        walletPubKeyHash: '0xwalletPubKeyHashMock',
        refundPubKeyHash: '0xrefundPubKeyHashMock',
        refundLocktime: '0xrefundLocktimeMock',
        vault: '0xvaultAddressMock',
      };

      mockDeposit = mockDepositsUtil.createDeposit(
        mockFundingTx,
        revealInstance,
        '0x1234567890123456789012345678901234567890', // Valid EVM address
        '0xEthSender',
        mockSeiConfig.chainName,
      ) as Deposit;

      mockContractInstance.initializeDeposit.mockClear();
      mockDepositsUtil.updateToInitializedDeposit.mockClear();
      mockAuditLogUtil.logDepositError.mockClear();
      mockAuditLogUtil.logStatusChange.mockClear();
      (DepositStore.update as jest.Mock).mockClear();

      mockContractInstance.initializeDeposit.mockResolvedValue({
        hash: '0xInitTxHashSuccess',
        wait: jest.fn().mockResolvedValue({
          status: 1,
          transactionHash: '0xInitTxHashSuccess',
          blockNumber: 123,
        }),
      });
    });

    it('should successfully initialize a deposit and return the transaction receipt', async () => {
      jest.spyOn((handler as any).l1DepositorContractProvider, 'deposits').mockResolvedValue(0);
      const result = await handler.initializeDeposit(mockDeposit);

      expect(result).toBeDefined();
      if (result && result.status !== undefined) {
        if (ethers.BigNumber.isBigNumber(result.status)) {
          expect(result.status.toNumber()).toBe(1);
        } else {
          expect(result.status).toBe(1);
        }
      }
      expect(result?.transactionHash).toBe('0xInitTxHashSuccess');
      expect(mockContractInstance.initializeDeposit).toHaveBeenCalledTimes(1);
      
      // Verify the contract was called with bytes32 format (not address)
      const callArgs = mockContractInstance.initializeDeposit.mock.calls[0];
      const l2DepositOwnerBytes32Arg = callArgs[2];
      // Should be a 32-byte hex string (66 chars including '0x')
      expect(l2DepositOwnerBytes32Arg).toMatch(/^0x[0-9a-fA-F]{64}$/);
      
      expect(mockDepositsUtil.updateToInitializedDeposit).toHaveBeenCalledTimes(1);
      expect(mockDeposit.hashes.eth.initializeTxHash).toBe('0xInitTxHashSuccess');
    });

    it('should return undefined and log error if L1 Depositor contract is not available', async () => {
      (handler as any).l1DepositorContract = undefined;
      const result = await handler.initializeDeposit(mockDeposit);

      expect(result).toBeUndefined();
      expect(mockAuditLogUtil.logDepositError).toHaveBeenCalledWith(
        mockDeposit.id,
        'L1 Depositor contract (signer) instance not available for initialization.',
        { internalError: 'L1 Depositor contract (signer) not available' },
      );
      expect(mockContractInstance.initializeDeposit).not.toHaveBeenCalled();
    });

    it('should return undefined and log error for an invalid EVM recipient address', async () => {
      jest.spyOn((handler as any).l1DepositorContractProvider, 'deposits').mockResolvedValue(0);
      mockDeposit.L1OutputEvent.l2DepositOwner = 'invalid-address';
      const result = await handler.initializeDeposit(mockDeposit);
      expect(result).toBeUndefined();
      expect(mockAuditLogUtil.logDepositError).toHaveBeenCalled();
    });

    it('should return undefined, log error, and revert status if L1 transaction reverts', async () => {
      jest.spyOn((handler as any).l1DepositorContractProvider, 'deposits').mockResolvedValue(0);
      mockContractInstance.initializeDeposit.mockResolvedValue({
        hash: '0xRevertedInitTxHash',
        wait: jest.fn().mockResolvedValue({
          status: 0,
          transactionHash: '0xRevertedInitTxHash',
          blockNumber: 124,
        }),
      });
      mockDeposit.status = DepositStatus.QUEUED;
      const result = await handler.initializeDeposit(mockDeposit);
      expect(result).toBeUndefined();
      expect(mockAuditLogUtil.logDepositError).toHaveBeenCalled();
    });

    it('should return undefined and log error if initializeDeposit throws an error', async () => {
      jest.spyOn((handler as any).l1DepositorContractProvider, 'deposits').mockResolvedValue(0);
      const errorMessage = 'Network error';
      mockContractInstance.initializeDeposit.mockRejectedValue(new Error(errorMessage));
      const result = await handler.initializeDeposit(mockDeposit);
      expect(result).toBeUndefined();
      expect(mockAuditLogUtil.logDepositError).toHaveBeenCalled();
    });
  });

  describe('finalizeDeposit', () => {
    beforeEach(() => {
      mockDepositForFinalize = {
        id: '36798305888235649988225211365882253459035954999386348233314415494390505703047',
        status: DepositStatus.INITIALIZED,
        chainId: mockSeiConfig.chainName,
        hashes: {
          eth: { initializeTxHash: '0xInitTxHash' },
          sei: {},
          btc: {},
          solana: {},
        },
        dates: {
          initializationAt: Date.now(),
        },
      };

      jest.spyOn(handler, 'checkDepositStatus').mockResolvedValue(1);
      mockDepositStore.getById.mockResolvedValue(mockDepositForFinalize);
      mockDepositsUtil.getDepositId.mockReturnValue('deposit-0xfundingtxhash-0');
      mockDepositsUtil.getDepositKey.mockReturnValue(
        '0xa6f9c63a6c4c5b93d1b3aa44b2bbb2d3084bfbbe4581da89528ee7ff22a1926f',
      );

      mockContractInstance.finalizeDeposit.mockResolvedValue({
        hash: '0xFinalizeTxHashSuccess',
        wait: jest.fn().mockResolvedValue({
          status: 1,
          transactionHash: '0xFinalizeTxHashSuccess',
          blockNumber: 456,
        }),
      });
    });

    it('should successfully finalize a deposit and return the transaction receipt', async () => {
      const result = await handler.finalizeDeposit(mockDepositForFinalize!);

      expect(result).toBeDefined();
      if (result && result.status !== undefined) {
        if (ethers.BigNumber.isBigNumber(result.status)) {
          expect(result.status.toNumber()).toBe(1);
        } else {
          expect(result.status).toBe(1);
        }
        expect(result.transactionHash).toBe('0xFinalizeTxHashSuccess');
      }
      expect(mockContractInstance.finalizeDeposit).toHaveBeenCalled();
    });

    it('should return undefined and log error if L1 Depositor contract is not available', async () => {
      (handler as any).l1DepositorContract = undefined;
      (handler as any).l1Signer = undefined;

      const result = await handler.finalizeDeposit(mockDepositForFinalize!);

      expect(result).toBeUndefined();
      expect(mockAuditLogUtil.logDepositError).toHaveBeenCalledWith(
        mockDepositForFinalize!.id,
        'L1 Depositor contract (signer) instance not available. Cannot finalize deposit.',
        { internalError: 'L1 Depositor contract (signer) not available' },
      );
    });

    it('should return undefined and log error if L1 finalizeDeposit transaction reverts', async () => {
      mockContractInstance.finalizeDeposit.mockResolvedValue({
        hash: '0xRevertedFinalizeTxHash',
        wait: jest.fn().mockResolvedValue({ status: 0, transactionHash: '0xRevertedFinalizeTxHash' }),
      });

      const result = await handler.finalizeDeposit(mockDepositForFinalize!);

      expect(result).toBeUndefined();
      expect(mockAuditLogUtil.logDepositError).toHaveBeenCalled();
    });

    it('should abort if on-chain status is already Finalized', async () => {
      (handler.checkDepositStatus as jest.Mock).mockResolvedValue(2);
      const result = await handler.finalizeDeposit(mockDepositForFinalize!);

      expect(result).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Deposit is already finalized on-chain. Skipping.'),
      );
      expect(mockContractInstance.finalizeDeposit).not.toHaveBeenCalled();
    });
  });

  describe('processTokensTransferredNttWithExecutorEvent', () => {
    let mockEventDeposit: Deposit;
    const mockDepositKey = '0xDepositKeyFromEvent';
    const mockAmount = ethers.BigNumber.from('1000000000000000000');
    const mockRecipient = '0x1234567890123456789012345678901234567890';
    const mockL1TxHash = '0xL1BridgeEventTxHash';
    const mockSequence = ethers.BigNumber.from(123);

    beforeEach(() => {
      mockEventDeposit = {
        id: mockDepositKey,
        chainId: mockSeiConfig.chainName,
        status: DepositStatus.FINALIZED,
        fundingTxHash: '0xfundingtxhash_event',
        outputIndex: 0,
        L1OutputEvent: {} as any,
        hashes: {
          btc: { btcTxHash: '0xbtc_event' },
          eth: { initializeTxHash: '0xinit_event', finalizeTxHash: '0xfinal_event' },
          sei: { l1BridgeTxHash: null, wormholeSequence: null },
          solana: { bridgeTxHash: null },
        },
        receipt: {} as any,
        owner: '0xOriginalOwner',
        dates: {
          createdAt: Date.now() - 20000,
          initializationAt: Date.now() - 15000,
          finalizationAt: Date.now() - 10000,
          lastActivityAt: Date.now() - 10000,
          awaitingWormholeVAAMessageSince: null,
          bridgedAt: null,
        },
        wormholeInfo: { txHash: null, transferSequence: null, bridgingAttempted: false },
        error: null,
      };

      mockDepositStore.getById.mockResolvedValue(mockEventDeposit);
      mockDepositStore.update.mockResolvedValue();
      (logger.info as jest.Mock).mockClear();
      (logger.warn as jest.Mock).mockClear();
      (logger.error as jest.Mock).mockClear();
    });

    it('should process a new bridge event, update deposit to BRIDGED, and store L1 bridge tx hash and sequence', async () => {
      mockEventDeposit.status = DepositStatus.INITIALIZED;
      mockEventDeposit.hashes.sei = { l1BridgeTxHash: null, wormholeSequence: null };
      mockEventDeposit.dates.bridgedAt = null;
      mockDepositStore.getById.mockResolvedValue(mockEventDeposit);

      await (handler as any).processTokensTransferredNttWithExecutorEvent(
        mockDepositKey,
        mockRecipient,
        mockAmount,
        mockSequence,
        mockL1TxHash,
        false,
      );

      expect(mockDepositStore.update).toHaveBeenCalledTimes(1);
      const updatedDepositArgument = mockDepositStore.update.mock.calls[0][0] as Deposit;

      expect(updatedDepositArgument.status).toBe(DepositStatus.BRIDGED);
      expect(updatedDepositArgument.hashes.sei?.l1BridgeTxHash).toBe(mockL1TxHash);
      expect(updatedDepositArgument.hashes.sei?.wormholeSequence).toBe(mockSequence.toString());
      expect(updatedDepositArgument.dates.bridgedAt).toBeDefined();
    });

    it('should log a warning and skip if deposit is not found', async () => {
      mockDepositStore.getById.mockResolvedValue(null);
      await (handler as any).processTokensTransferredNttWithExecutorEvent(
        mockDepositKey,
        mockRecipient,
        mockAmount,
        mockSequence,
        mockL1TxHash,
        false,
      );

      expect(mockDepositStore.update).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`Unknown deposit. ID: ${mockDepositKey}. Ignoring.`),
      );
    });

    it('should skip update if deposit is already BRIDGED', async () => {
      mockEventDeposit.status = DepositStatus.BRIDGED;
      mockDepositStore.getById.mockResolvedValue(mockEventDeposit);
      await (handler as any).processTokensTransferredNttWithExecutorEvent(
        mockDepositKey,
        mockRecipient,
        mockAmount,
        mockSequence,
        mockL1TxHash,
        false,
      );

      expect(mockDepositStore.update).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Deposit already BRIDGED'));
    });

    it('should log an error and skip if deposit chainId does not match handler chainId', async () => {
      mockEventDeposit.chainId = 'DIFFERENT_CHAIN';
      mockDepositStore.getById.mockResolvedValue(mockEventDeposit);
      await (handler as any).processTokensTransferredNttWithExecutorEvent(
        mockDepositKey,
        mockRecipient,
        mockAmount,
        mockSequence,
        mockL1TxHash,
        false,
      );

      expect(mockDepositStore.update).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Mismatched chain'));
    });
  });

  describe('hasDepositBeenMintedOnTBTC', () => {
    let mockCheckDeposit: Deposit;
    let tbtcVaultProviderMock: jest.Mocked<EthersContract>;
    const testFundingTxHash = '0x' + 'a'.repeat(64);
    const testOutputIndex = 0;
    let actualDepositId: string;

    beforeEach(() => {
      const DepositsJs = jest.requireActual('../../../utils/Deposits.js');
      actualDepositId = DepositsJs.getDepositId(testFundingTxHash, testOutputIndex);

      mockCheckDeposit = {
        id: actualDepositId,
        chainId: mockSeiConfig.chainName,
        fundingTxHash: testFundingTxHash,
        outputIndex: testOutputIndex,
        L1OutputEvent: {
          fundingTx: { version: '1', inputVector: '', outputVector: '', locktime: '' },
          reveal: {
            fundingOutputIndex: 0,
            blindingFactor: '',
            walletPubKeyHash: '',
            refundPubKeyHash: '',
            refundLocktime: '',
            vault: '',
          },
          l2DepositOwner: '',
          l2Sender: '',
        },
        hashes: {
          btc: { btcTxHash: '0xbtc_mint' },
          eth: { initializeTxHash: '0xInitForMintCheck', finalizeTxHash: null },
          sei: { l1BridgeTxHash: null, wormholeSequence: null },
          solana: { bridgeTxHash: null },
        },
        receipt: {
          depositor: '',
          blindingFactor: '',
          walletPublicKeyHash: '',
          refundPublicKeyHash: '',
          refundLocktime: '',
          extraData: '',
        },
        owner: '0xowner_mint',
        status: DepositStatus.INITIALIZED,
        dates: {
          createdAt: 0,
          initializationAt: 0,
          finalizationAt: null,
          lastActivityAt: 0,
          awaitingWormholeVAAMessageSince: null,
          bridgedAt: null,
        },
        wormholeInfo: { txHash: null, transferSequence: null, bridgingAttempted: false },
        error: null,
      };

      tbtcVaultProviderMock = (handler as any).tbtcVaultProvider as jest.Mocked<EthersContract>;
      tbtcVaultProviderMock.queryFilter = jest.fn();
      if (!tbtcVaultProviderMock.filters) {
        (tbtcVaultProviderMock as any).filters = {};
      }
      (tbtcVaultProviderMock.filters.OptimisticMintingFinalized as jest.Mock) = jest.fn(() => ({}));

      mockGetTransactionReceiptImplementation.mockResolvedValue({
        blockNumber: 100,
        transactionHash: '0xInitForMintCheck',
        status: 1,
      });

      mockAuditLogUtil.logDepositError.mockClear();
      (logger.warn as jest.Mock).mockClear();
    });

    it('should return true if OptimisticMintingFinalized event is found', async () => {
      const mockEvent = {
        transactionHash: '0xMintFinalizedEventTx',
        args: { depositKey: ethers.BigNumber.from(actualDepositId) },
      };
      tbtcVaultProviderMock.queryFilter.mockResolvedValue([mockEvent] as any);

      const result = await (handler as any).hasDepositBeenMintedOnTBTC(mockCheckDeposit);
      expect(result).toBe(true);
      expect(tbtcVaultProviderMock.queryFilter).toHaveBeenCalled();
    });

    it('should return false if OptimisticMintingFinalized event is not found', async () => {
      tbtcVaultProviderMock.queryFilter.mockResolvedValue([]);

      const result = await (handler as any).hasDepositBeenMintedOnTBTC(mockCheckDeposit);
      expect(result).toBe(false);
    });

    it('should return false and log error if tbtcVaultProvider is not available', async () => {
      (handler as any).tbtcVaultProvider = undefined;
      const result = await (handler as any).hasDepositBeenMintedOnTBTC(mockCheckDeposit);
      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('TBTCVault provider not available'));
    });
  });
});

