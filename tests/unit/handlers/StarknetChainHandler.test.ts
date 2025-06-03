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
import { type Contract as EthersContract, ethers } from 'ethers';
import type { FundingTransaction } from '../../../types/FundingTransaction.type.js';

// Mock external dependencies
jest.mock('../../../utils/DepositStore');
jest.mock('../../../utils/Logger');
jest.mock('../../../utils/starknetAddress');
jest.mock('../../../utils/Deposits');
jest.mock('../../../utils/GetTransactionHash');
jest.mock('../../../utils/AuditLog');

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
  starknetPrivateKey: '0xStarknetL2PrivateKey',
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

  // Define mock implementations here so they are in scope for beforeEach
  const mockWalletImpl = (privateKey: string, provider: any) => {
    if (typeof privateKey !== 'string' || !privateKey.startsWith('0x')) {
      // Invalid privateKey handling (no logging needed in test)
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
    mockStarknetAddress.formatStarkNetAddressForContract.mockImplementation(
      (addr) => addr as string,
    ); // Simple pass-through
    mockStarknetAddress.extractAddressFromBitcoinScript.mockReturnValue(
      '0xExtractedStarkNetAddress',
    );
    mockGetTransactionHashUtil.getFundingTxHash.mockReturnValue('0xfundingtxhash');
    mockDepositsUtil.getDepositId.mockImplementation((hash, index) => `deposit-${hash}-${index}`);
    mockDepositsUtil.createDeposit.mockImplementation((ftx, rev, owner, sender, chainNameInput) => {
      const fundingTxHash = mockGetTransactionHashUtil.getFundingTxHash(ftx as any);
      const outputIndex = (rev as Reveal).fundingOutputIndex;
      const currentDepositId = mockDepositsUtil.getDepositId(fundingTxHash, outputIndex);
      return {
        id: currentDepositId,
        chainName: chainNameInput,
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
    // Add mocks for getDeposit and updateDeposit if they are part of DepositStore
    mockDepositStore.getById = jest.fn(); // Assuming getById is the correct method
    mockDepositStore.update = jest.fn(); // Assuming update is the correct method
    mockDepositStore.create = jest.fn();
    mockDepositStore.getAll = jest.fn();
    mockDepositStore.delete = jest.fn();

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

    // Initialize L2 components (which in StarknetChainHandler primarily means L1 contract instances)
    // This will set up this.starkGateContract and this.starkGateContractProvider
    // Use a promise resolve pattern if initializeL2 is async (it is)
    return (handler as any).initializeL2();
  });

  describe('Constructor and Initialization', () => {
    it('should construct and initialize L1 components successfully with valid config', async () => {
      expect(handler).toBeInstanceOf(StarknetChainHandler);
      expect(ethers.Contract).toHaveBeenCalledTimes(3); // starkGate, starkGateProvider, tbtcVaultProvider
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
        '0xStarknetOwner',
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
      mockStarknetAddress.formatStarkNetAddressForContract.mockImplementation(
        (addr) => addr as string,
      );
    });

    it('should successfully initialize a deposit and return the transaction receipt', async () => {
      const result = await handler.initializeDeposit(mockDeposit);

      expect(result).toBeDefined();
      expect(result?.transactionHash).toBe('0xInitTxHashSuccess');
      expect(result?.status).toBe(1);

      expect(mockContractInstance.initializeDeposit).toHaveBeenCalledTimes(1);
      const expectedFormattedOwner = mockStarknetAddress.formatStarkNetAddressForContract(
        mockDeposit.L1OutputEvent!.l2DepositOwner,
      );
      expect(mockContractInstance.initializeDeposit).toHaveBeenCalledWith(
        mockFundingTx,
        revealInstance,
        expectedFormattedOwner,
        {},
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
      mockStarknetAddress.validateStarkNetAddress.mockReturnValue(false);

      const result = await handler.initializeDeposit(mockDeposit);

      expect(result).toBeUndefined();
      expect(mockAuditLogUtil.logDepositError).toHaveBeenCalledWith(
        mockDeposit.id,
        'Invalid StarkNet recipient address.',
        { address: mockDeposit.L1OutputEvent!.l2DepositOwner },
      );
      expect(mockContractInstance.initializeDeposit).not.toHaveBeenCalled();
    });

    it('should return undefined, log error, and revert status if L1 transaction reverts', async () => {
      mockContractInstance.initializeDeposit.mockResolvedValue({
        hash: '0xRevertedInitTxHash',
        wait: jest.fn().mockResolvedValue({
          status: 0, // Reverted
          transactionHash: '0xRevertedInitTxHash',
          blockNumber: 124,
        }),
      });

      // Simulate deposit status was optimistically changed before revert, or ensure initial status is QUEUED
      mockDeposit.status = DepositStatus.QUEUED; // Or any status that would be "reverted" from
      // If initializeDeposit itself changes status before tx.wait(), that needs to be reflected here.
      // The current implementation updates hashes.eth.initializeTxHash optimistically, but not status.

      const result = await handler.initializeDeposit(mockDeposit);

      expect(result).toBeUndefined();
      expect(mockAuditLogUtil.logDepositError).toHaveBeenCalledWith(
        mockDeposit.id,
        'L1 initializeDeposit tx reverted: 0xRevertedInitTxHash',
        expect.objectContaining({
          receipt: expect.objectContaining({ transactionHash: '0xRevertedInitTxHash', status: 0 }),
        }),
      );
      expect(mockAuditLogUtil.logStatusChange).toHaveBeenCalledWith(
        expect.objectContaining({ id: mockDeposit.id, status: DepositStatus.QUEUED }), // Expected to be reverted to QUEUED
        DepositStatus.QUEUED, // New status
        DepositStatus.INITIALIZED, // Old status (the status it was *before* this failed attempt, assuming it would have gone to INITIALIZED)
        // The code currently does: logStatusChange(deposit, DepositStatus.QUEUED, DepositStatus.INITIALIZED);
        // This implies it assumes the "old" status for logging was the intended "INITIALIZED".
        // Let's ensure the passed deposit to logStatusChange has status: QUEUED.
      );
      expect(DepositStore.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: mockDeposit.id, status: DepositStatus.QUEUED }),
      );
    });

    it('should return undefined and log error if starkGateContract.initializeDeposit throws an error', async () => {
      const errorMessage = 'Network error';
      mockContractInstance.initializeDeposit.mockRejectedValue(new Error(errorMessage));

      const result = await handler.initializeDeposit(mockDeposit);

      expect(result).toBeUndefined();
      expect(mockAuditLogUtil.logDepositError).toHaveBeenCalledWith(
        mockDeposit.id,
        `Failed to initialize deposit: ${errorMessage}`,
        expect.any(Object),
        mockStarknetConfig.chainName,
      );
    });
  });

  describe('finalizeDeposit', () => {
    let mockDepositForFinalize: Deposit;
    const mockL2TxHash = '0xL2FinalizeTxHash';
    let revealForFinalize: Reveal;

    beforeEach(() => {
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
        '0xStarknetOwnerFinalize',
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
        mockGetTransactionHashUtil.getFundingTxHash(
          mockDepositForFinalize.L1OutputEvent!.fundingTx,
        ),
        mockDepositForFinalize.L1OutputEvent!.reveal.fundingOutputIndex,
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
      const expectedDepositId = mockDepositsUtil.getDepositId(
        mockGetTransactionHashUtil.getFundingTxHash(
          mockDepositForFinalize.L1OutputEvent!.fundingTx,
        ),
        mockDepositForFinalize.L1OutputEvent!.reveal.fundingOutputIndex,
      );

      const result = await handler.finalizeDeposit(mockDepositForFinalize);

      expect(result).toBeDefined();
      expect(result?.transactionHash).toBe('0xFinalizeTxHashSuccess');
      expect(result?.status).toBe(1);

      expect(mockContractInstance.finalizeDeposit).toHaveBeenCalledTimes(1);
      expect(mockContractInstance.finalizeDeposit).toHaveBeenCalledWith(expectedDepositId, {
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

      const result = await handler.finalizeDeposit(mockDepositForFinalize);

      expect(result).toBeUndefined();
      expect(mockAuditLogUtil.logDepositError).toHaveBeenCalledWith(
        mockDepositForFinalize.id,
        'L1 Depositor contract (signer) instance not available for finalization.',
        { internalError: 'L1 Depositor contract (signer) not available' },
      );
      expect(mockContractInstance.finalizeDeposit).not.toHaveBeenCalled();
    });

    it('should return undefined and log error if deposit is missing L2 transaction hash', async () => {
      mockDepositForFinalize.hashes.starknet!.l2TxHash = null; // Remove L2 tx hash

      const result = await handler.finalizeDeposit(mockDepositForFinalize);

      expect(result).toBeUndefined();
      expect(mockAuditLogUtil.logDepositError).toHaveBeenCalledWith(
        mockDepositForFinalize.id,
        'Deposit missing L2 transaction hash. L2 minting not confirmed before L1 finalization attempt.',
        { currentStatus: mockDepositForFinalize.status },
      );
      expect(mockContractInstance.finalizeDeposit).not.toHaveBeenCalled();
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

      const result = await handler.finalizeDeposit(mockDepositForFinalize);

      expect(result).toBeUndefined();
      expect(mockAuditLogUtil.logDepositError).toHaveBeenCalledWith(
        mockDepositForFinalize.id,
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

      const result = await handler.finalizeDeposit(mockDepositForFinalize);

      expect(result).toBeUndefined();
      expect(mockAuditLogUtil.logDepositError).toHaveBeenCalledWith(
        mockDepositForFinalize.id,
        `Failed to finalize deposit: ${errorMessage}`,
        expect.any(Object),
        mockStarknetConfig.chainName,
      );
    });
  });

  describe('processTBTCBridgedToStarkNetEvent', () => {
    let mockFullDepositEvent: Deposit;
    let mockEventDepositKey: string;
    let mockAmount: ethers.BigNumber;
    let mockStarkNetRecipient: ethers.BigNumber;
    let mockMessageNonce: ethers.BigNumber;
    let mockL1TxHash: string;

    beforeEach(() => {
      mockEventDepositKey = 'deposit_id_starknet_bridge_123';
      mockAmount = ethers.BigNumber.from('1000000000000000000'); // 1 ETH in wei
      mockStarkNetRecipient = ethers.BigNumber.from(
        '0x0123456789012345678901234567890123456789012345678901234567890123',
      ); // Example valid StarkNet address as BigNumber
      mockMessageNonce = ethers.BigNumber.from('12345');
      mockL1TxHash = '0xL1BridgeEventTxHash';

      mockFullDepositEvent = {
        id: mockEventDepositKey,
        chainName: mockStarknetConfig.chainName,
        status: DepositStatus.INITIALIZED, // Default for most tests in this block
        fundingTxHash: '0xSomeFundingTxHash',
        outputIndex: 0,
        hashes: {
          btc: { btcTxHash: '0xSomeBtcTxHash' },
          eth: { initializeTxHash: '0xSomeEthInitTxHash', finalizeTxHash: null },
          starknet: { l1BridgeTxHash: null, l2TxHash: null }, // Reset for each test usually
          solana: { bridgeTxHash: null },
        },
        receipt: {
          depositor: '0xDepositorAddress',
          blindingFactor: '0xBlindingFactor',
          walletPublicKeyHash: '0xWalletPubKeyHash',
          refundPublicKeyHash: '0xRefundPubKeyHash',
          refundLocktime: '0xRefundLocktime',
          extraData: '0xExtraData',
        },
        L1OutputEvent: {
          fundingTx: {} as FundingTransaction,
          reveal: {} as Reveal,
          l2DepositOwner: '0xL2Owner',
          l2Sender: '0xL2Sender',
        },
        owner: '0xOwnerAddress',
        dates: {
          createdAt: Date.now() - 3600000, // 1 hour ago
          initializationAt: Date.now() - 1800000, // 30 mins ago
          finalizationAt: null,
          lastActivityAt: Date.now() - 1800000,
          awaitingWormholeVAAMessageSince: null,
          bridgedAt: null, // Reset for each test usually
        },
        wormholeInfo: { txHash: null, transferSequence: null, bridgingAttempted: false },
        error: null,
      };
      mockDepositStore.getById.mockResolvedValue(mockFullDepositEvent);
    });

    it('should successfully process a TBTCBridgedToStarkNet event and update deposit', async () => {
      mockFullDepositEvent.status = DepositStatus.INITIALIZED;
      mockFullDepositEvent.hashes.starknet = { l1BridgeTxHash: null, l2TxHash: null };
      mockFullDepositEvent.dates.bridgedAt = null;
      mockDepositStore.getById.mockResolvedValue(mockFullDepositEvent);

      await (handler as any).processTBTCBridgedToStarkNetEvent(
        mockEventDepositKey,
        mockAmount,
        mockStarkNetRecipient.toString(),
        mockMessageNonce,
        mockL1TxHash,
      );

      expect(mockDepositStore.getById).toHaveBeenCalledWith(mockEventDepositKey);
      const updatedDepositArgument = mockDepositStore.update.mock.calls[0][0] as Deposit;
      expect(updatedDepositArgument.status).toBe(DepositStatus.BRIDGED);
      expect(updatedDepositArgument.hashes.starknet?.l1BridgeTxHash).toBe(mockL1TxHash);
      expect(updatedDepositArgument.dates.bridgedAt).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          `LiveEvent | TBTCBridgedToStarkNet for ${mockStarknetConfig.chainName}: Processing | DepositId: ${mockEventDepositKey}`,
        ),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          `Deposit updated to BRIDGED. ID: ${mockEventDepositKey}. L1 Tx: ${mockL1TxHash}`,
        ),
      );
    });

    it('should log info and not update if deposit is not found', async () => {
      mockDepositStore.getById.mockResolvedValue(null);
      await (handler as any).processTBTCBridgedToStarkNetEvent(
        mockEventDepositKey,
        mockAmount,
        mockStarkNetRecipient.toString(),
        mockMessageNonce,
        mockL1TxHash,
      );
      expect(mockDepositStore.update).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`Unknown deposit. ID: ${mockEventDepositKey}. Ignoring.`),
      );
    });

    it('should log info and not update if deposit is already BRIDGED (live event replay)', async () => {
      mockFullDepositEvent.status = DepositStatus.BRIDGED;
      mockDepositStore.getById.mockResolvedValue(mockFullDepositEvent);

      await (handler as any).processTBTCBridgedToStarkNetEvent(
        mockEventDepositKey,
        mockAmount,
        mockStarkNetRecipient.toString(),
        mockMessageNonce,
        mockL1TxHash,
      );
      expect(mockDepositStore.update).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          `Deposit already BRIDGED. ID: ${mockEventDepositKey}. Potential replay of live event. Skipping update.`,
        ),
      );
    });
    it('should log info and not update if deposit is already BRIDGED (past event)', async () => {
      mockFullDepositEvent.status = DepositStatus.BRIDGED;
      mockDepositStore.getById.mockResolvedValue(mockFullDepositEvent);
      await (handler as any).processTBTCBridgedToStarkNetEvent(
        mockEventDepositKey,
        mockAmount,
        mockStarkNetRecipient.toString(),
        mockMessageNonce,
        mockL1TxHash,
        true, // isPastEvent
      );
      expect(mockDepositStore.update).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining(
          `PastEvent | TBTCBridgedToStarkNet for ${mockStarknetConfig.chainName}: Deposit already BRIDGED. ID: ${mockEventDepositKey}. Skipping update.`,
        ),
      );
    });

    it('should log an error and not update if chainName mismatches', async () => {
      mockFullDepositEvent.chainName = 'DIFFERENT_CHAIN';
      mockDepositStore.getById.mockResolvedValue(mockFullDepositEvent);

      await (handler as any).processTBTCBridgedToStarkNetEvent(
        mockEventDepositKey,
        mockAmount,
        mockStarkNetRecipient.toString(),
        mockMessageNonce,
        mockL1TxHash,
      );
      expect(mockDepositStore.update).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(`Mismatched chain for DepositKey ${mockEventDepositKey}`),
        expect.any(Object),
      );
    });
  });

  describe('hasDepositBeenMintedOnTBTC', () => {
    let mockCheckDeposit: Deposit;
    let tbtcVaultProviderMock: jest.Mocked<EthersContract>; // More specific type for the mock
    // Define realistic inputs for getDepositId
    const testFundingTxHash = '0x' + 'a'.repeat(64); // Example funding tx hash
    const testOutputIndex = 0;
    let actualDepositId: string; // Will hold the ID generated by actualGetDepositId

    beforeEach(() => {
      // Use jest.requireActual to get the original implementation of getDepositId
      const DepositsJs = jest.requireActual('../../../utils/Deposits');
      actualDepositId = DepositsJs.getDepositId(testFundingTxHash, testOutputIndex);

      // Simplified mock deposit for these tests
      mockCheckDeposit = {
        id: actualDepositId, // Use the realistically generated ID
        chainName: mockStarknetConfig.chainName,
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
        `Error checking if deposit has been minted on tBTC: ${errorMessage}`,
        expect.any(Object),
        mockStarknetConfig.chainName,
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

  /*
  // Commenting out this entire describe block as `updateDepositStatus` method does not exist on StarknetChainHandler
  describe('updateDepositStatus', () => {
    const currentTestDepositId = 'test-deposit-id-for-update';
    const eventDepositForMismatch: Deposit = {} as Deposit;

    beforeEach(() => {
      Object.assign(eventDepositForMismatch, {
        id: currentTestDepositId,
        chainName: 'DifferentChain',
        status: DepositStatus.QUEUED, // Changed PENDING to QUEUED
        fundingTxHash: 'event-funding-hash',
        outputIndex: 1,
        hashes: {
          btc: { btcTxHash: 'hash' },
          eth: { initializeTxHash: 'hash', finalizeTxHash: 'hash' },
          solana: { bridgeTxHash: 'hash' },
          starknet: { l1BridgeTxHash: 'hash', l2TxHash: 'hash' },
        },
        receipt: {
          depositor: 'd',
          blindingFactor: 'b',
          walletPublicKeyHash: 'w',
          refundPublicKeyHash: 'r',
          refundLocktime: 'l',
          extraData: 'e',
        },
        L1OutputEvent: {
          fundingTx: {} as FundingTransaction,
          reveal: {} as Reveal,
          l2DepositOwner: 'o',
          l2Sender: 's',
        },
        owner: 'event-owner',
        dates: {
          createdAt: Date.now(),
          initializationAt: null,
          finalizationAt: null,
          lastActivityAt: Date.now(),
          awaitingWormholeVAAMessageSince: null,
          bridgedAt: null,
        },
        wormholeInfo: { txHash: null, transferSequence: null, bridgingAttempted: false },
        error: null,
      });
    });

    it('should log an error and not update if chain names mismatch', async () => {
      mockDepositStore.getById.mockResolvedValueOnce(eventDepositForMismatch);
      // await (handler as any).updateDepositStatus(currentTestDepositId, eventDepositForMismatch); // Method does not exist

      expect(mockDepositStore.getById).toHaveBeenCalledWith(currentTestDepositId);
      expect(logger.error).toHaveBeenCalledWith(
        // Changed to logger.error
        expect.stringContaining('Mismatched chainName for deposit'),
        currentTestDepositId,
      );
      expect(mockDepositStore.update).not.toHaveBeenCalled();
    });
  });
  */

  describe('processBridgedEvent', () => {
    let mockFullDepositEvent: Deposit;
    let mockEventDepositKey: string;
    let mockAmount: string;
    let mockStarkNetRecipient: string;
    let mockMessageNonce: string;
    let mockL1TxHash: string;

    beforeEach(() => {
      mockEventDepositKey = 'deposit_id_starknet_bridge_123';
      mockAmount = '1000000000000000000'; // 1 ETH in wei
      mockStarkNetRecipient = '0xRecipientStarkNetAddress';
      mockMessageNonce = '12345';
      mockL1TxHash = '0xL1BridgeEventTxHash';

      mockFullDepositEvent = {
        id: mockEventDepositKey,
        chainName: mockStarknetConfig.chainName,
        status: DepositStatus.INITIALIZED,
        fundingTxHash: '0xSomeFundingTxHash',
        outputIndex: 0,
        hashes: {
          btc: { btcTxHash: '0xSomeBtcTxHash' },
          eth: { initializeTxHash: '0xSomeEthInitTxHash', finalizeTxHash: null },
          starknet: { l1BridgeTxHash: null, l2TxHash: null },
          solana: { bridgeTxHash: null },
        },
        receipt: {
          depositor: '0xDepositorAddress',
          blindingFactor: '0xBlindingFactor',
          walletPublicKeyHash: '0xWalletPubKeyHash',
          refundPublicKeyHash: '0xRefundPubKeyHash',
          refundLocktime: '0xRefundLocktime',
          extraData: '0xExtraData',
        },
        L1OutputEvent: {
          fundingTx: {} as FundingTransaction,
          reveal: {} as Reveal,
          l2DepositOwner: '0xL2Owner',
          l2Sender: '0xL2Sender',
        },
        owner: '0xOwnerAddress',
        dates: {
          createdAt: Date.now() - 3600000,
          initializationAt: Date.now() - 1800000,
          finalizationAt: null,
          lastActivityAt: Date.now() - 1800000,
          awaitingWormholeVAAMessageSince: null,
          bridgedAt: null,
        },
        wormholeInfo: { txHash: null, transferSequence: null, bridgingAttempted: false },
        error: null,
      };
      mockDepositStore.getById.mockResolvedValue(mockFullDepositEvent);
    });

    it('should successfully process a TBTCBridgedToStarkNet event and update deposit', async () => {
      mockFullDepositEvent.status = DepositStatus.INITIALIZED;
      mockFullDepositEvent.hashes.starknet = { l1BridgeTxHash: null, l2TxHash: null };
      mockFullDepositEvent.dates.bridgedAt = null;
      mockDepositStore.getById.mockResolvedValue(mockFullDepositEvent);

      await (handler as any).processTBTCBridgedToStarkNetEvent(
        mockEventDepositKey,
        mockAmount,
        mockStarkNetRecipient.toString(),
        mockMessageNonce,
        mockL1TxHash,
      );

      expect(mockDepositStore.getById).toHaveBeenCalledWith(mockEventDepositKey);
      const updatedDepositArgument = mockDepositStore.update.mock.calls[0][0] as Deposit;
      expect(updatedDepositArgument.status).toBe(DepositStatus.BRIDGED);
      expect(updatedDepositArgument.hashes.starknet?.l1BridgeTxHash).toBe(mockL1TxHash);
      expect(updatedDepositArgument.dates.bridgedAt).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          `LiveEvent | TBTCBridgedToStarkNet for ${mockStarknetConfig.chainName}: Processing | DepositId: ${mockEventDepositKey}`,
        ),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          `Deposit updated to BRIDGED. ID: ${mockEventDepositKey}. L1 Tx: ${mockL1TxHash}`,
        ),
      );
    });

    it('should log info and not update if deposit is not found', async () => {
      mockDepositStore.getById.mockResolvedValue(null);
      await (handler as any).processTBTCBridgedToStarkNetEvent(
        mockEventDepositKey,
        mockAmount,
        mockStarkNetRecipient.toString(),
        mockMessageNonce,
        mockL1TxHash,
      );
      expect(mockDepositStore.update).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`Unknown deposit. ID: ${mockEventDepositKey}. Ignoring.`),
      );
    });

    it('should log info and not update if deposit is already BRIDGED (live event replay)', async () => {
      mockFullDepositEvent.status = DepositStatus.BRIDGED;
      mockDepositStore.getById.mockResolvedValue(mockFullDepositEvent);

      await (handler as any).processTBTCBridgedToStarkNetEvent(
        mockEventDepositKey,
        mockAmount,
        mockStarkNetRecipient.toString(),
        mockMessageNonce,
        mockL1TxHash,
      );
      expect(mockDepositStore.update).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          `Deposit already BRIDGED. ID: ${mockEventDepositKey}. Potential replay of live event. Skipping update.`,
        ),
      );
    });
    it('should log info and not update if deposit is already BRIDGED (past event)', async () => {
      mockFullDepositEvent.status = DepositStatus.BRIDGED;
      mockDepositStore.getById.mockResolvedValue(mockFullDepositEvent);
      await (handler as any).processTBTCBridgedToStarkNetEvent(
        mockEventDepositKey,
        mockAmount,
        mockStarkNetRecipient.toString(),
        mockMessageNonce,
        mockL1TxHash,
        true, // isPastEvent
      );
      expect(mockDepositStore.update).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining(
          `PastEvent | TBTCBridgedToStarkNet for ${mockStarknetConfig.chainName}: Deposit already BRIDGED. ID: ${mockEventDepositKey}. Skipping update.`,
        ),
      );
    });

    it('should log an error and not update if chainName mismatches', async () => {
      mockFullDepositEvent.chainName = 'DIFFERENT_CHAIN';
      mockDepositStore.getById.mockResolvedValue(mockFullDepositEvent);

      await (handler as any).processTBTCBridgedToStarkNetEvent(
        mockEventDepositKey,
        mockAmount,
        mockStarkNetRecipient.toString(),
        mockMessageNonce,
        mockL1TxHash,
      );
      expect(mockDepositStore.update).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(`Mismatched chain for DepositKey ${mockEventDepositKey}`),
        expect.any(Object),
      );
    });
  });
});
