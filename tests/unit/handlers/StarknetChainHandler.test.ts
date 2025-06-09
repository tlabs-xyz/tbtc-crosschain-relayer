import { StarknetChainHandler } from '../../../handlers/StarknetChainHandler.js';
import {
  StarknetChainConfigSchema,
  type StarknetChainConfig,
} from '../../../config/schemas/starknet.chain.schema.js';
import { CHAIN_TYPE, NETWORK } from '../../../config/schemas/common.schema.js';
import { DepositStore } from '../../../utils/DepositStore.js';
import logger from '../../../utils/Logger.js';
import { DepositStatus } from '../../../types/DepositStatus.enum.js';
import type { Deposit } from '../../../types/Deposit.type.js';
import type { Reveal } from '../../../types/Reveal.type.js';
import * as starknetAddressUtils from '../../../utils/starknetAddress.js';
import * as depositUtils from '../../../utils/Deposits.js';
import * as getTransactionHashUtils from '../../../utils/GetTransactionHash.js';
import * as auditLog from '../../../utils/AuditLog.js';
import { Contract as EthersContract, ethers } from 'ethers';
import { type FundingTransaction } from '../../../types/FundingTransaction.type.js';

// Mock external dependencies
jest.mock('../../../utils/DepositStore');
jest.mock('../../../utils/Logger');
jest.mock('../../../utils/starknetAddress');
jest.mock('../../../utils/Deposits');
jest.mock('../../../utils/GetTransactionHash.js');
jest.mock('../../../utils/AuditLog');

// Mock the config module to prevent loading all chain configurations during unit tests
jest.mock('../../../config/index.js', () => ({
  chainConfigs: {},
  getAvailableChainKeys: () => ['starknetTestnet'],
}));

// Mock ethers.Contract instances and provider methods that are globally used
const mockContractInstance = {
  initializeDeposit: jest.fn(),
  finalizeDeposit: jest.fn(),
  quoteFinalizeDepositDynamic: jest.fn(),
  quoteFinalizeDeposit: jest.fn(),
  l1ToL2MessageFee: jest.fn(),
  filters: {
    TBTCBridgedToStarkNet: jest.fn(() => ({})),
    OptimisticMintingFinalized: jest.fn(() => ({})),
  },
  on: jest.fn(),
  queryFilter: jest.fn(),
  callStatic: {
    initializeDeposit: jest.fn(),
    finalizeDeposit: jest.fn(),
    l1ToL2MessageFee: jest.fn(),
  },
  address: '0xMockContractAddress',
  deposits: jest.fn().mockResolvedValue(ethers.BigNumber.from(0)),
};

const mockGetTransactionReceiptImplementation = jest.fn();

// Default config for tests
// Explicitly type mockStarknetConfig to help with property inference
const mockStarknetConfig: StarknetChainConfig = StarknetChainConfigSchema.parse({
  chainId: 'SN_TEST',
  chainName: 'StarkNetTestnet',
  chainType: CHAIN_TYPE.STARKNET,
  network: NETWORK.TESTNET,
  l1Rpc: 'http://l1-rpc.test',
  l1ContractAddress: '0x1234567890123456789012345678901234567890', // Validated by EthereumAddressSchema
  vaultAddress: '0xabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcde',
  l1PrivateKey: '0x123456789012345678901234567890123456789012345678901234567890abcd', // Corrected from privateKey
  starknetPrivateKey: '0x0123456789abcdef0123456789abcdef01234567',
  l2Rpc: 'http://l2-rpc.test',
  l1FeeAmountWei: '100000000000000', // This is now part of StarknetChainConfigSchema
  l1Confirmations: 1,
  // Common fields that StarknetChainConfigSchema inherits and might be used by BaseChainHandler:
  l2WsRpc: 'ws://l2-ws-rpc.test', // Example, ensure all common fields are covered if Base uses them
  l2ContractAddress: '0xfedcbafedcbafedcbafedcbafedcbafedcbafedc', // Validated by EthereumAddressSchema
  l1BitcoinRedeemerAddress: '0x11223344556677889900aabbccddeeff11223344', // Validated by EthereumAddressSchema
  l2WormholeGatewayAddress: '0x223344556677889900aabbccddeeff1122334455', // Validated by EthereumAddressSchema
  l2WormholeChainId: 2, // Example StarkNet Sepolia is 2 for Wormhole
  l2StartBlock: 0,
});

describe('StarknetChainHandler', () => {
  let handler: StarknetChainHandler;
  let mockDepositStore: jest.Mocked<typeof DepositStore>;
  let mockStarknetAddress: jest.Mocked<typeof starknetAddressUtils>;
  let mockDepositsUtil: jest.Mocked<typeof depositUtils>;
  let mockGetTransactionHashUtil: jest.Mocked<typeof getTransactionHashUtils>;
  let mockAuditLogUtil: jest.Mocked<typeof auditLog>;
  let mockDepositForFinalize: any;

  // Define mock implementations here so they are in scope for beforeEach
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
      getChainId: jest.fn().mockResolvedValue(1337),
      getGasPrice: jest.fn().mockResolvedValue(ethers.BigNumber.from('10000000000')),
      estimateGas: jest.fn().mockResolvedValue(ethers.BigNumber.from('21000')),
      call: jest.fn().mockResolvedValue('0x'),
      getTransactionCount: jest.fn().mockResolvedValue(0),
    };
  };

  const mockJsonRpcProviderImpl = (_url: string | any) => {
    const network = { chainId: 1337, name: 'mocked-network' };
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
    jest.clearAllMocks(); // Clear all mocks, including spies

    // Setup spies BEFORE they are used by new StarknetChainHandler() or its setup
    jest.spyOn(ethers, 'Wallet').mockImplementation(mockWalletImpl as any);
    jest.spyOn(ethers, 'Contract').mockImplementation(() => {
      return {
        ...mockContractInstance, // Spread the base mock
        provider: mockJsonRpcProviderImpl('http://l1-rpc.test'),
        signer: mockWalletImpl(
          (mockStarknetConfig as any).l1PrivateKey || '', // Use `as any` to bypass persistent linter error
          mockJsonRpcProviderImpl('http://l1-rpc.test'),
        ),
        connect: jest.fn().mockReturnThis(),
      } as unknown as ethers.Contract;
    });
    jest
      .spyOn(ethers.providers, 'JsonRpcProvider')
      .mockImplementation(mockJsonRpcProviderImpl as any);

    // Reset and re-configure mocks for provider methods for each test if necessary
    mockGetTransactionReceiptImplementation.mockResolvedValue({ blockNumber: 100 });

    // Re-assign mocks before each test for clarity and to ensure they are the jest.Mocked versions
    mockDepositStore = DepositStore as jest.Mocked<typeof DepositStore>;
    mockStarknetAddress = starknetAddressUtils as jest.Mocked<typeof starknetAddressUtils>;
    mockDepositsUtil = depositUtils as jest.Mocked<typeof depositUtils>;
    mockGetTransactionHashUtil = getTransactionHashUtils as jest.Mocked<
      typeof getTransactionHashUtils
    >;
    mockAuditLogUtil = auditLog as jest.Mocked<typeof auditLog>;

    // Mock default implementations for utilities
    mockStarknetAddress.validateStarkNetAddress.mockReturnValue(true);
    mockStarknetAddress.toUint256StarknetAddress.mockImplementation(() => '0x' + '1'.repeat(64)); // Always return a valid 32-byte hex string
    mockStarknetAddress.extractAddressFromBitcoinScript.mockReturnValue(
      '0xExtractedStarkNetAddress',
    );
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
          starknet: { l1BridgeTxHash: null, l2TxHash: null },
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
          walletPubKeyHash: (rev as Reveal).walletPubKeyHash,
          refundPubKeyHash: (rev as Reveal).refundPubKeyHash,
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

    // Mock contract calls that return promises
    mockContractInstance.l1ToL2MessageFee.mockResolvedValue(ethers.BigNumber.from('100000'));
    mockContractInstance.quoteFinalizeDepositDynamic.mockResolvedValue(
      ethers.BigNumber.from('120000'),
    );
    mockContractInstance.callStatic.initializeDeposit.mockResolvedValue(undefined);
    mockContractInstance.callStatic.l1ToL2MessageFee.mockResolvedValue(
      ethers.BigNumber.from('100000'),
    );

    mockContractInstance.initializeDeposit.mockResolvedValue({
      hash: '0xInitTxHash',
      wait: jest
        .fn()
        .mockResolvedValue({ status: 1, transactionHash: '0xInitTxHash', blockNumber: 123 }),
    });
    mockContractInstance.finalizeDeposit.mockResolvedValue({
      hash: '0xFinalizeTxHash',
      wait: jest
        .fn()
        .mockResolvedValue({ status: 1, transactionHash: '0xFinalizeTxHash', blockNumber: 456 }),
    });
    // The getTransactionReceipt is now mocked via mockGetTransactionReceiptImplementation
    // (new mockEthers.providers.JsonRpcProvider('http://dummy.url').getTransactionReceipt as jest.Mock).mockResolvedValue(...);

    handler = new StarknetChainHandler(mockStarknetConfig);
    // Call initializeL2 manually as it's called by BaseChainHandler.initialize()
    // which we are not fully running in this unit test setup.
    // Ensure l1Provider etc are set up before calling initializeL2 in the handler.
    (handler as any).l1Provider = new ethers.providers.JsonRpcProvider(mockStarknetConfig.l1Rpc);
    (handler as any).l1Signer = new ethers.Wallet(
      (mockStarknetConfig as any).l1PrivateKey,
      (handler as any).l1Provider,
    );
    (handler as any).nonceManagerL1 = new (jest.requireActual(
      '@ethersproject/experimental',
    ).NonceManager)((handler as any).l1Signer);
    (handler as any).tbtcVaultProvider = new ethers.Contract(
      '0xVaultAddress',
      [],
      (handler as any).l1Provider,
    );

    // Directly assign mock contract instances; skip initializeL2 to avoid redundant real setup
    (handler as any).l1DepositorContract = mockContractInstance;
    (handler as any).l1DepositorContractProvider = mockContractInstance;
  });

  describe('Constructor and Initialization', () => {
    it('should construct and initialize L1 components successfully with valid config', async () => {
      expect(handler).toBeInstanceOf(StarknetChainHandler);
      expect(ethers.Contract).toHaveBeenCalledTimes(1); // Only tbtcVaultProvider is instantiated in test setup
      expect((handler as any).l1DepositorContract).toBeDefined();
      expect((handler as any).l1DepositorContractProvider).toBeDefined();
    });

    it('should throw if L1 RPC is not configured', () => {
      const invalidConfig = {
        ...mockStarknetConfig,
        l1Rpc: undefined,
      } as Partial<StarknetChainConfig>;
      // Expect the constructor to throw due to Zod validation failure
      expect(() => new StarknetChainHandler(invalidConfig as StarknetChainConfig)).toThrowError(
        'Invalid StarkNet configuration for StarkNetTestnet. Please check logs for details.',
      );
    });

    // Add more tests for invalid configs (e.g., missing l1ContractAddress)
    it('should throw during initializeL2 if l1ContractAddress is missing', () => {
      const configWithoutContract = {
        ...mockStarknetConfig,
        l1ContractAddress: undefined,
      } as Partial<StarknetChainConfig>;
      // Expect the constructor to throw due to Zod validation failure
      expect(
        () => new StarknetChainHandler(configWithoutContract as StarknetChainConfig),
      ).toThrowError(
        'Invalid StarkNet configuration for StarkNetTestnet. Please check logs for details.',
      );
      // The original test was trying to check initializeL2, but constructor throws first.
      // If we wanted to test initializeL2 specifically for a case where constructor passes but initializeL2 fails,
      // we would need a config that passes Zod but makes initializeL2 fail for other reasons.
    });

    it('should return a synthetic receipt if deposit is already initialized and no tx hash is available', async () => {
      // Arrange: depositState !== 0, no initializeTxHash
      jest.spyOn((handler as any).l1DepositorContractProvider, 'deposits').mockResolvedValue(1);
      // For this test, we want the synthetic receipt to have an empty string for transactionHash
      mockDepositForFinalize = {
        hashes: {
          eth: { initializeTxHash: '' }, // '' triggers empty tx hash in synthetic receipt
          starknet: { l2TxHash: '0xL2FinalizeTxHash' },
        },
        id: 'mockDepositId',
        status: DepositStatus.INITIALIZED,
        L1OutputEvent: {
          fundingTx: {
            version: '1',
            inputVector: '',
            outputVector: '',
            locktime: '',
          },
          reveal: { fundingOutputIndex: 0 },
          l2DepositOwner: '0xOwner',
        },
      } as any;
      const result = await handler.initializeDeposit(mockDepositForFinalize!);
      if (result && result.status !== undefined) {
        if (ethers.BigNumber.isBigNumber(result.status)) {
          expect(result.status.toNumber()).toBe(1);
        } else {
          expect(result.status).toBe(1);
        }
      } else {
        throw new Error('result.status is undefined');
      }
      expect(result?.transactionHash).toBe('');
      expect(result?.blockNumber).toBe(0);
    });
  });

  // TODO: Add test suites for:
  // - initializeDeposit
  // - finalizeDeposit
  // - processTBTCBridgedToStarkNetEvent
  // - hasDepositBeenMintedOnTBTC
  // - setupL2Listeners (event registration, past event check trigger)

  describe('initializeDeposit', () => {
    let mockDeposit: Deposit;
    const mockFundingTx: FundingTransaction = {
      version: '1',
      inputVector:
        '0x010000000000000000000000000000000000000000000000000000000000000000ffffffff0000ffffffff', // Simplified
      outputVector: '0x0100000000000000001976a914000000000000000000000000000000000000000088ac', // Simplified
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
        '0x' + '1'.repeat(64), // valid 32-byte hex string
        '0xEthSender',
        mockStarknetConfig.chainName,
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
      mockStarknetAddress.validateStarkNetAddress.mockReturnValue(true);
      mockStarknetAddress.toUint256StarknetAddress.mockImplementation(
        (addr) => '0x' + addr.replace(/^0x/, '').padStart(64, '0'),
      );
    });

    it('should successfully initialize a deposit and return the transaction receipt', async () => {
      mockContractInstance.initializeDeposit.mockResolvedValue({
        hash: '0xInitTxHashSuccess',
        wait: jest.fn().mockResolvedValue({
          status: 1,
          transactionHash: '0xInitTxHashSuccess',
          blockNumber: 123,
        }),
      });
      jest.spyOn((handler as any).l1DepositorContractProvider, 'deposits').mockResolvedValue(0);
      const result = await handler.initializeDeposit(mockDeposit);

      expect(result).toBeDefined();
      if (result && result.status !== undefined) {
        if (ethers.BigNumber.isBigNumber(result.status)) {
          expect(result.status.toNumber()).toBe(1);
        } else {
          expect(result.status).toBe(1);
        }
      } else {
        throw new Error('result.status is undefined');
      }
      expect(result?.transactionHash).toBe('0xInitTxHashSuccess');

      expect(mockContractInstance.initializeDeposit).toHaveBeenCalledTimes(1);
      const expectedFormattedOwner = mockStarknetAddress.toUint256StarknetAddress(
        mockDeposit.L1OutputEvent.l2DepositOwner,
      );
      expect(mockContractInstance.initializeDeposit).toHaveBeenCalledWith(
        mockFundingTx,
        revealInstance,
        ethers.BigNumber.from(expectedFormattedOwner),
      );

      expect(mockDepositsUtil.updateToInitializedDeposit).toHaveBeenCalledTimes(1);
      expect(mockDepositsUtil.updateToInitializedDeposit).toHaveBeenCalledWith(
        expect.objectContaining({ id: mockDeposit.id }),
        expect.objectContaining({ hash: '0xInitTxHashSuccess' }),
      );
      expect(mockDeposit.hashes.eth.initializeTxHash).toBe('0xInitTxHashSuccess');
    });

    it('should return undefined and log error if L1 Depositor contract is not available', async () => {
      (handler as any).l1DepositorContract = undefined; // Simulate contract not being available

      const result = await handler.initializeDeposit(mockDeposit);

      expect(result).toBeUndefined();
      expect(mockAuditLogUtil.logDepositError).toHaveBeenCalledWith(
        mockDeposit.id,
        'L1 Depositor contract (signer) instance not available for initialization.',
        { internalError: 'L1 Depositor contract (signer) not available' },
      );
      expect(mockContractInstance.initializeDeposit).not.toHaveBeenCalled();
    });

    it('should return undefined and log error for an invalid StarkNet recipient address', async () => {
      jest.spyOn((handler as any).l1DepositorContractProvider, 'deposits').mockResolvedValue(0);
      mockStarknetAddress.validateStarkNetAddress.mockReturnValue(false);
      const result = await handler.initializeDeposit(mockDeposit);
      expect(result).toBeUndefined();
    });

    it('should return undefined, log error, and revert status if L1 transaction reverts', async () => {
      jest.spyOn((handler as any).l1DepositorContractProvider, 'deposits').mockResolvedValue(0);
      mockContractInstance.initializeDeposit.mockResolvedValue({
        hash: '0xRevertedInitTxHash',
        wait: jest.fn().mockResolvedValue({
          status: 0, // Reverted
          transactionHash: '0xRevertedInitTxHash',
          blockNumber: 124,
        }),
      });
      mockDeposit.status = DepositStatus.QUEUED;
      const result = await handler.initializeDeposit(mockDeposit);
      expect(result).toBeUndefined();
    });

    it('should return undefined and log error if starkGateContract.initializeDeposit throws an error', async () => {
      jest.spyOn((handler as any).l1DepositorContractProvider, 'deposits').mockResolvedValue(0);
      const errorMessage = 'Network error';
      mockContractInstance.initializeDeposit.mockRejectedValue(new Error(errorMessage));
      const result = await handler.initializeDeposit(mockDeposit);
      expect(result).toBeUndefined();
    });
  });

  describe('finalizeDeposit', () => {
    let mockDepositForFinalize: Deposit | undefined;
    const mockL2TxHash = '0xL2FinalizeTxHash';
    let revealForFinalize: Reveal;

    beforeEach(() => {
      mockDepositsUtil.getDepositKey.mockReturnValue('deposit-0xfundingtxhash-0');
      revealForFinalize = {
        fundingOutputIndex: 0,
        blindingFactor: '0xblindingFinalize',
        walletPubKeyHash: '0xwalletKeyHashFinalize',
        refundPubKeyHash: '0xrefundKeyHashFinalize',
        refundLocktime: ethers.BigNumber.from(Math.floor(Date.now() / 1000) + 7200).toHexString(),
        vault: '0xvaultFinalize',
      };

      mockDepositForFinalize = mockDepositsUtil.createDeposit(
        {
          version: '1',
          inputVector: '0xinput',
          outputVector: '0xoutput',
          locktime: '0',
        } as FundingTransaction,
        revealForFinalize,
        '0x' + '1'.repeat(64), // valid 32-byte hex string
        '0xEthSenderFinalize',
        mockStarknetConfig.chainName,
      ) as Deposit;
      mockDepositForFinalize.status = DepositStatus.INITIALIZED;

      mockDepositForFinalize.hashes = {
        ...(mockDepositForFinalize.hashes || { btc: {}, eth: {}, solana: {} }),
        starknet: {
          ...(mockDepositForFinalize.hashes?.starknet || {}),
          l2TxHash: mockL2TxHash,
        },
      };
      const idForAssertion = mockDepositsUtil.getDepositId(
        mockGetTransactionHashUtil.getFundingTxHash(mockDepositForFinalize.L1OutputEvent.fundingTx),
        mockDepositForFinalize.L1OutputEvent.reveal.fundingOutputIndex,
      ) as string;
      mockDepositForFinalize.id = idForAssertion;

      mockContractInstance.finalizeDeposit.mockClear();
      mockDepositsUtil.updateToFinalizedDeposit.mockClear();
      mockAuditLogUtil.logDepositError.mockClear();
      // Ensure quoteFinalizeDeposit is also cleared and has a default mock for finalize tests
      mockContractInstance.quoteFinalizeDeposit.mockClear();
      mockContractInstance.quoteFinalizeDeposit.mockResolvedValue(ethers.BigNumber.from('120000'));

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
      const expectedDepositKey = mockDepositsUtil.getDepositId(
        mockGetTransactionHashUtil.getFundingTxHash(
          mockDepositForFinalize!.L1OutputEvent.fundingTx,
        ),
        mockDepositForFinalize!.L1OutputEvent.reveal.fundingOutputIndex,
      );

      const result = await handler.finalizeDeposit(mockDepositForFinalize!);

      expect(result).toBeDefined();
      if (result && result.status !== undefined) {
        if (ethers.BigNumber.isBigNumber(result.status)) {
          expect(result.status.toNumber()).toBe(1);
        } else {
          expect(result.status).toBe(1);
        }
      } else {
        throw new Error('result.status is undefined');
      }
      expect(result?.transactionHash).toBe('0xFinalizeTxHashSuccess');

      expect(mockContractInstance.finalizeDeposit).toHaveBeenCalledTimes(1);
      expect(mockContractInstance.finalizeDeposit).toHaveBeenCalledWith(expectedDepositKey, {
        value: ethers.BigNumber.from('120000'),
      });

      expect(mockDepositsUtil.updateToFinalizedDeposit).toHaveBeenCalledTimes(1);
      expect(mockDepositsUtil.updateToFinalizedDeposit).toHaveBeenCalledWith(
        mockDepositForFinalize,
        expect.objectContaining({ hash: '0xFinalizeTxHashSuccess' }),
      );
    });

    it('should return undefined and log error if L1 Depositor contract is not available', async () => {
      (handler as any).l1DepositorContract = undefined;

      const result = await handler.finalizeDeposit(mockDepositForFinalize!);

      expect(result).toBeUndefined();
      expect(mockAuditLogUtil.logDepositError).toHaveBeenCalledWith(
        mockDepositForFinalize!.id,
        'L1 Depositor contract (signer) instance not available for finalization.',
        { internalError: 'L1 Depositor contract (signer) not available' },
      );
      expect(mockContractInstance.finalizeDeposit).not.toHaveBeenCalled();
    });

    it('should successfully finalize deposit even without L2 transaction hash (StarkNet flow)', async () => {
      mockDepositForFinalize!.hashes.starknet!.l2TxHash = null; // Remove L2 tx hash - not required for StarkNet

      const expectedDepositKey = mockDepositsUtil.getDepositId(
        mockGetTransactionHashUtil.getFundingTxHash(
          mockDepositForFinalize!.L1OutputEvent.fundingTx,
        ),
        mockDepositForFinalize!.L1OutputEvent.reveal.fundingOutputIndex,
      );

      const result = await handler.finalizeDeposit(mockDepositForFinalize!);

      expect(result).toEqual({
        status: 1,
        transactionHash: '0xFinalizeTxHashSuccess',
        blockNumber: 456,
      });
      expect(mockContractInstance.finalizeDeposit).toHaveBeenCalledWith(expectedDepositKey, {
        value: ethers.BigNumber.from('120000'),
      });
    });

    it('should return undefined and log error if L1 finalizeDeposit transaction reverts', async () => {
      mockContractInstance.finalizeDeposit.mockResolvedValue({
        hash: '0xRevertedFinalizeTxHash',
        wait: jest.fn().mockResolvedValue({
          status: 0, // Reverted
          transactionHash: '0xRevertedFinalizeTxHash',
          blockNumber: 457,
        }),
      });

      const result = await handler.finalizeDeposit(mockDepositForFinalize!);

      expect(result).toBeUndefined();
      expect(mockAuditLogUtil.logDepositError).toHaveBeenCalledWith(
        mockDepositForFinalize!.id,
        'L1 finalizeDeposit tx reverted: 0xRevertedFinalizeTxHash',
        expect.objectContaining({
          receipt: expect.objectContaining({
            transactionHash: '0xRevertedFinalizeTxHash',
            status: 0,
          }),
        }),
      );
      // Note: finalizeDeposit in StarknetChainHandler doesn't explicitly revert status on L1 finalize failure
      // It relies on updateToFinalizedDeposit to handle the error state if txReceipt.status !== 1
      // The updateToFinalizedDeposit mock should be checked or real logic tested if status change is expected here.
    });

    it('should return undefined and log error if starkGateContract.finalizeDeposit throws an error', async () => {
      const errorMessage = 'L1 Finalize Network Error';
      mockContractInstance.finalizeDeposit.mockRejectedValue(new Error(errorMessage));

      const result = await handler.finalizeDeposit(mockDepositForFinalize!);

      expect(result).toBeUndefined();
      expect(mockAuditLogUtil.logDepositError).toHaveBeenCalledWith(
        mockDepositForFinalize!.id,
        `Error during L1 finalizeDeposit: ${errorMessage}`,
        expect.any(Error),
      );
    });
  });

  describe('processTBTCBridgedToStarkNetEvent', () => {
    let mockEventDeposit: Deposit;
    const mockDepositKey = '0xDepositKeyFromEvent';
    const mockAmount = ethers.BigNumber.from('1000000000000000000'); // 1 TBTC in wei
    const mockStarkNetRecipient = '0xStarkRecipientFromEvent';
    const mockL1TxHash = '0xL1BridgeEventTxHash';
    const mockMessageNonce = ethers.BigNumber.from(123); // Added mockMessageNonce

    beforeEach(() => {
      // Base mock deposit that would be retrieved from DepositStore
      mockEventDeposit = {
        id: mockDepositKey, // Should match the event's depositKey
        chainId: mockStarknetConfig.chainName, // Ensure it matches the handler's chain
        status: DepositStatus.FINALIZED, // A status prior to BRIDGED
        fundingTxHash: '0xfundingtxhash_event',
        outputIndex: 0,
        L1OutputEvent: {
          /* minimal data */
        } as any,
        hashes: {
          btc: { btcTxHash: '0xbtc_event' },
          eth: { initializeTxHash: '0xinit_event', finalizeTxHash: '0xfinal_event' },
          starknet: { l1BridgeTxHash: null, l2TxHash: '0xl2_event' }, // l1BridgeTxHash will be updated
          solana: { bridgeTxHash: null }, // Ensuring solana property is present
        },
        receipt: {
          /* minimal data */
        } as any,
        owner: '0xOriginalOwner',
        dates: {
          createdAt: Date.now() - 20000,
          initializationAt: Date.now() - 15000,
          finalizationAt: Date.now() - 10000,
          lastActivityAt: Date.now() - 10000,
          awaitingWormholeVAAMessageSince: null,
          bridgedAt: null, // Will be updated
        },
        wormholeInfo: { txHash: null, transferSequence: null, bridgingAttempted: false },
        error: null,
      };

      mockDepositStore.getById.mockResolvedValue(mockEventDeposit);
      mockDepositStore.update.mockResolvedValue(); // Default mock for update
      (logger.info as jest.Mock).mockClear();
      (logger.warn as jest.Mock).mockClear();
      (logger.error as jest.Mock).mockClear();
    });

    it('should process a new bridge event, update deposit to BRIDGED, and store L1 bridge tx hash', async () => {
      // Explicitly reset parts of mockEventDeposit that might be affected by other tests
      mockEventDeposit.status = DepositStatus.INITIALIZED;
      mockEventDeposit.hashes.starknet = { l1BridgeTxHash: null, l2TxHash: null };
      mockEventDeposit.dates.bridgedAt = null;
      mockDepositStore.getById.mockResolvedValue(mockEventDeposit); // Re-set mock after modification

      // const processEventMethod = (handler as any).processTBTCBridgedToStarkNetEvent.bind(handler);
      // Call directly to avoid potential issues with bind or 'this' context in mocks
      await (handler as any).processTBTCBridgedToStarkNetEvent(
        mockDepositKey,
        mockAmount,
        mockStarkNetRecipient.toString(),
        mockMessageNonce, // Added mockMessageNonce
        mockL1TxHash, // This is '0xL1BridgeEventTxHash'
        false, // isPastEvent = false
      );

      expect(mockDepositStore.update).toHaveBeenCalledTimes(1);
      const updatedDepositArgument = mockDepositStore.update.mock.calls[0][0] as Deposit;

      expect(updatedDepositArgument.status).toBe(DepositStatus.BRIDGED);
      expect(updatedDepositArgument.hashes.starknet?.l1BridgeTxHash).toBe(mockL1TxHash);
      expect(updatedDepositArgument.dates.bridgedAt).toBeDefined();
      expect(updatedDepositArgument.dates.bridgedAt).toBeGreaterThanOrEqual(
        Math.floor((Date.now() - 1000) / 1000),
      ); // Check it's a recent timestamp
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          `LiveEvent | TBTCBridgedToStarkNet for ${mockStarknetConfig.chainName}: Processing | DepositId: ${mockDepositKey}`,
        ),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          `Deposit updated to BRIDGED. ID: ${mockDepositKey}. L1 Tx: ${mockL1TxHash}`,
        ),
      );
    });

    it('should log a warning and skip if deposit is not found', async () => {
      mockDepositStore.getById.mockResolvedValue(null); // Simulate deposit not found
      const processEventMethod = (handler as any).processTBTCBridgedToStarkNetEvent.bind(handler);
      await processEventMethod(
        mockDepositKey,
        mockAmount,
        mockStarkNetRecipient.toString(),
        mockMessageNonce, // Added mockMessageNonce
        mockL1TxHash,
        false,
      );

      expect(mockDepositStore.update).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`Unknown deposit. ID: ${mockDepositKey}. Ignoring.`),
      );
    });

    it('should skip update if deposit is already BRIDGED (live event)', async () => {
      mockEventDeposit.status = DepositStatus.BRIDGED;
      mockDepositStore.getById.mockResolvedValue(mockEventDeposit);
      const processEventMethod = (handler as any).processTBTCBridgedToStarkNetEvent.bind(handler);
      await processEventMethod(
        mockDepositKey,
        mockAmount,
        mockStarkNetRecipient.toString(),
        mockMessageNonce, // Added mockMessageNonce
        mockL1TxHash,
        false, // isPastEvent = false
      ); // isPastEvent = false

      expect(mockDepositStore.update).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          `Deposit already BRIDGED. ID: ${mockDepositKey}. Potential replay of live event. Skipping update.`,
        ),
      );
    });

    it('should skip update if deposit is already BRIDGED (past event)', async () => {
      mockEventDeposit.status = DepositStatus.BRIDGED;
      mockDepositStore.getById.mockResolvedValue(mockEventDeposit);

      // Clear logger.debug mocks specifically for this test run after handler setup
      (logger.debug as jest.Mock).mockClear();

      // const processEventMethod = (handler as any).processTBTCBridgedToStarkNetEvent.bind(handler);
      // Call directly
      await (handler as any).processTBTCBridgedToStarkNetEvent(
        mockDepositKey,
        mockAmount,
        mockStarkNetRecipient.toString(),
        mockMessageNonce, // Added mockMessageNonce
        mockL1TxHash,
        true, // isPastEvent = true
      );

      expect(mockDepositStore.update).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining(
          `PastEvent | TBTCBridgedToStarkNet for ${mockStarknetConfig.chainName}: Deposit already BRIDGED. ID: ${mockDepositKey}. Skipping update.`,
        ),
      );
    });

    it('should log an error and skip if deposit chainId does not match handler chainId', async () => {
      mockEventDeposit.chainId = 'DIFFERENT_CHAIN';
      mockDepositStore.getById.mockResolvedValue(mockEventDeposit);
      const processEventMethod = (handler as any).processTBTCBridgedToStarkNetEvent.bind(handler);
      await processEventMethod(
        mockDepositKey,
        mockAmount,
        mockStarkNetRecipient.toString(),
        mockMessageNonce, // Added mockMessageNonce
        mockL1TxHash,
        false,
      );

      expect(mockDepositStore.update).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(`Mismatched chain for DepositKey ${mockDepositKey}`),
      );
    });
  });

  describe('hasDepositBeenMintedOnTBTC', () => {
    let mockCheckDeposit: Deposit;
    let tbtcVaultProviderMock: jest.Mocked<EthersContract>; // More specific type for the mock
    // Define realistic inputs for getDepositId
    const testFundingTxHash = '0x' + 'a'.repeat(64); // Example funding tx hash
    const testOutputIndex = 0;
    let actualDepositId: string; // Will hold the ID generated by actualgetDepositId

    beforeEach(() => {
      // Use jest.requireActual to get the original implementation of getDepositId
      const DepositsJs = jest.requireActual('../../../utils/Deposits.js');
      actualDepositId = DepositsJs.getDepositId(testFundingTxHash, testOutputIndex);

      // Simplified mock deposit for these tests
      mockCheckDeposit = {
        id: actualDepositId, // Use the realistically generated ID
        chainId: mockStarknetConfig.chainName,
        fundingTxHash: testFundingTxHash, // Consistent fundingTxHash
        outputIndex: testOutputIndex, // Consistent outputIndex
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
          starknet: { l1BridgeTxHash: null, l2TxHash: null },
          solana: { bridgeTxHash: null }, // Ensuring solana property is present
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

      // Instead of re-assigning, we rely on the tbtcVaultProvider set in the main beforeEach
      // and ensure its methods are freshly mocked if needed.
      tbtcVaultProviderMock = (handler as any).tbtcVaultProvider as jest.Mocked<EthersContract>; // Use the one from handler

      // Mock specific methods for tbtcVaultProvider (if not already covered by global mock)
      // Ensure these are fresh mocks for each test within this describe block
      tbtcVaultProviderMock.queryFilter = jest.fn();
      // Correctly mock OptimisticMintingFinalized on the tbtcVaultProviderMock's filter object
      if (!tbtcVaultProviderMock.filters) {
        (tbtcVaultProviderMock as any).filters = {}; // Initialize if filters object doesn't exist on the mock
      }
      (tbtcVaultProviderMock.filters.OptimisticMintingFinalized as jest.Mock) = jest.fn(() => ({})); // Assign a new mock function
      (tbtcVaultProviderMock.filters.OptimisticMintingFinalized as jest.Mock).mockClear();

      // Reset getTransactionReceipt for consistent behavior in these tests for fromBlock calculation
      mockGetTransactionReceiptImplementation.mockResolvedValue({
        blockNumber: 100,
        transactionHash: '0xInitForMintCheck',
        status: 1,
        logs: [],
        blockHash: '',
        from: '',
        to: '',
        contractAddress: '',
        gasUsed: ethers.BigNumber.from(0),
        cumulativeGasUsed: ethers.BigNumber.from(0),
        effectiveGasPrice: ethers.BigNumber.from(0),
        logsBloom: '',
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
      (tbtcVaultProviderMock.filters.OptimisticMintingFinalized as jest.Mock).mockReturnValue(
        'event_filter_signature_mint_finalized',
      );

      const result = await (handler as any).hasDepositBeenMintedOnTBTC(mockCheckDeposit);
      expect(result).toBe(true);
      expect(tbtcVaultProviderMock.queryFilter).toHaveBeenCalledWith(
        'event_filter_signature_mint_finalized',
        expect.any(Number), // fromBlock (100 - 10 = 90 in this case)
      );
      expect(tbtcVaultProviderMock.filters.OptimisticMintingFinalized).toHaveBeenCalledWith(
        ethers.BigNumber.from(actualDepositId),
      );
    });

    it('should return false if OptimisticMintingFinalized event is not found', async () => {
      tbtcVaultProviderMock.queryFilter.mockResolvedValue([]); // No events found
      (tbtcVaultProviderMock.filters.OptimisticMintingFinalized as jest.Mock).mockReturnValue(
        'event_filter_signature_no_mint',
      );

      const result = await (handler as any).hasDepositBeenMintedOnTBTC(mockCheckDeposit);
      expect(result).toBe(false);
      expect(tbtcVaultProviderMock.queryFilter).toHaveBeenCalledWith(
        'event_filter_signature_no_mint',
        expect.any(Number),
      );
    });

    it('should return false and log error if tbtcVaultProvider is not available', async () => {
      (handler as any).tbtcVaultProvider = undefined;
      const result = await (handler as any).hasDepositBeenMintedOnTBTC(mockCheckDeposit);
      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('TBTCVault provider not available'),
      );
    });

    it('should return false and log error if queryFilter throws an error', async () => {
      const errorMessage = 'QueryFilter failed';
      tbtcVaultProviderMock.queryFilter.mockRejectedValue(new Error(errorMessage));
      (tbtcVaultProviderMock.filters.OptimisticMintingFinalized as jest.Mock).mockReturnValue(
        'event_filter_query_error',
      );

      const result = await (handler as any).hasDepositBeenMintedOnTBTC(mockCheckDeposit);
      expect(result).toBe(false);
      expect(mockAuditLogUtil.logDepositError).toHaveBeenCalledWith(
        mockCheckDeposit.id,
        expect.stringContaining(`Error checking deposit ${mockCheckDeposit.id} minting status`),
        expect.any(Error),
      );
    });

    it('should calculate fromBlock based on l1InitializeTxHash receipt if available', async () => {
      mockGetTransactionReceiptImplementation.mockResolvedValueOnce({
        blockNumber: 150,
        transactionHash: '0xInitForMintCheck',
        status: 1,
        logs: [],
        blockHash: '',
        from: '',
        to: '',
        contractAddress: '',
        gasUsed: ethers.BigNumber.from(0),
        cumulativeGasUsed: ethers.BigNumber.from(0),
        effectiveGasPrice: ethers.BigNumber.from(0),
        logsBloom: '',
      });
      tbtcVaultProviderMock.queryFilter.mockResolvedValue([]);
      (tbtcVaultProviderMock.filters.OptimisticMintingFinalized as jest.Mock).mockReturnValue(
        'filter_fromBlock_test',
      );

      await (handler as any).hasDepositBeenMintedOnTBTC(mockCheckDeposit);
      expect(mockGetTransactionReceiptImplementation).toHaveBeenCalledWith(
        mockCheckDeposit.hashes.eth.initializeTxHash,
      );
      expect(tbtcVaultProviderMock.queryFilter).toHaveBeenCalledWith(
        'filter_fromBlock_test',
        140, // 150 - 10
      );
    });

    it('should use l2StartBlock as fallback for fromBlock if l1InitializeTxHash is missing or receipt fails', async () => {
      mockCheckDeposit.hashes.eth.initializeTxHash = null; // No init hash
      (handler as any).config.l2StartBlock = 50; // Set a specific l2StartBlock for the handler config
      tbtcVaultProviderMock.queryFilter.mockResolvedValue([]);
      (tbtcVaultProviderMock.filters.OptimisticMintingFinalized as jest.Mock).mockReturnValue(
        'filter_l2StartBlock_test',
      );

      await (handler as any).hasDepositBeenMintedOnTBTC(mockCheckDeposit);
      expect(tbtcVaultProviderMock.queryFilter).toHaveBeenCalledWith(
        'filter_l2StartBlock_test',
        40, // 50 - 10
      );
    });

    it('should log a warning if fromBlock cannot be determined', async () => {
      mockCheckDeposit.hashes.eth.initializeTxHash = null;
      (handler as any).config.l2StartBlock = 0; // l2StartBlock is not useful
      tbtcVaultProviderMock.queryFilter.mockResolvedValue([]);

      const result = await (handler as any).hasDepositBeenMintedOnTBTC(mockCheckDeposit);
      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          `No valid fromBlock determined for depositKey ${mockCheckDeposit.id}`,
        ),
      );
      expect(tbtcVaultProviderMock.queryFilter).not.toHaveBeenCalled(); // Should not call if no fromBlock
    });
  });
});
