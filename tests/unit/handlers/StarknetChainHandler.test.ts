import { StarknetChainHandler } from '../../../handlers/StarknetChainHandler.js';
import {
  StarknetChainConfigSchema,
  type StarknetChainConfig,
} from '../../../config/schemas/starknet.chain.schema.js';
import { CHAIN_TYPE, NETWORK } from '../../../config/schemas/common.schema.js';
import { DepositStore } from '../../../utils/DepositStore.js';
import logger from '../../../utils/Logger.js';
import { DepositStatus } from '../../../types/DepositStatus.enum';
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

// Mock ethers.Contract instances and provider methods that are globally used
const mockContractInstance = {
  initializeDeposit: jest.fn(),
  finalizeDeposit: jest.fn(),
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
  },
  address: '0xMockContractAddress',
};

const mockGetTransactionReceiptImplementation = jest.fn();

// Default config for tests
const mockStarknetConfig = StarknetChainConfigSchema.parse({
  chainId: 'SN_TEST', // This will be ignored by StarknetChainConfigSchema but BaseChainHandler might use it if it were part of a merged type directly
  chainName: 'StarkNetTestnet',
  chainType: CHAIN_TYPE.STARKNET,
  network: NETWORK.TESTNET,
  l1Rpc: 'http://l1-rpc.test',
  l1ContractAddress: '0x1234567890123456789012345678901234567890', // Validated by EthereumAddressSchema
  vaultAddress: '0xabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcde',
  privateKey: '0x123456789012345678901234567890123456789012345678901234567890abcd', // L1 Signer private key (64 hex chars)
  starknetPrivateKey: '0xStarknetL2PrivateKey', // Added for completeness, though not directly used in all current tests
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
    console.log('>>>>> MOCK ethers.Wallet CONSTRUCTOR CALLED (via spyOn) <<<<<');
    if (typeof privateKey !== 'string' || !privateKey.startsWith('0x')) {
      // console.warn('MockWallet invoked with potentially invalid privateKey:', privateKey);
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
    jest.spyOn(ethers, 'Contract').mockImplementation(() => mockContractInstance as any);
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
    mockDepositsUtil.createDeposit.mockImplementation((ftx, rev, owner, sender, chainId) => {
      const fundingTxHash = mockGetTransactionHashUtil.getFundingTxHash(ftx as any);
      const depositId = mockDepositsUtil.getDepositId(fundingTxHash, (rev as Reveal)[0]);
      return {
        id: depositId,
        chainId,
        owner: owner as string, // Ensure owner is string
        status: DepositStatus.QUEUED,
        L1OutputEvent: {
          // Ensure L1OutputEvent structure is present for initializeDeposit tests
          fundingTx: ftx as FundingTransaction,
          reveal: rev as Reveal,
          l2DepositOwner: owner as string, // Assuming owner is the l2DepositOwner for StarkNet
          l2Sender: sender as string,
        },
        hashes: {
          eth: { initializeTxHash: null, finalizeTxHash: null },
          btc: { btcTxHash: fundingTxHash }, // Store actual btcTxHash
          starknet: { l1BridgeTxHash: null, l2TxHash: null },
        },
        dates: {
          createdAt: Date.now(),
          initializationAt: null, // Set to null initially
          finalizationAt: null,
          lastActivityAt: Date.now(),
          awaitingWormholeVAAMessageSince: null,
          bridgedAt: null,
        },
        receipt: {
          // Add a minimal receipt structure if needed by other parts of the code
          depositor: sender as string,
          blindingFactor: (rev as Reveal)[1],
          walletPublicKeyHash: (rev as Reveal)[2],
          refundPublicKeyHash: (rev as Reveal)[3],
          refundLocktime: (rev as Reveal)[4],
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
    mockDepositsUtil.getDepositId.mockImplementation(
      (hash, index) => `deposit-${hash}-${index}_mocked_in_create_deposit_too`,
    );

    // Mock contract calls that return promises
    mockContractInstance.l1ToL2MessageFee.mockResolvedValue(ethers.BigNumber.from('100000'));
    mockContractInstance.callStatic.initializeDeposit.mockResolvedValue(undefined); // Simulate successful callStatic
    mockContractInstance.initializeDeposit.mockResolvedValue({
      hash: '0xInitTxHash',
      wait: jest
        .fn()
        .mockResolvedValue({ status: 1, transactionHash: '0xInitTxHash', blockNumber: 123 }),
    });
    mockContractInstance.quoteFinalizeDeposit.mockResolvedValue(ethers.BigNumber.from('200000'));
    mockContractInstance.callStatic.finalizeDeposit.mockResolvedValue(undefined);
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
      (mockStarknetConfig as any).privateKey,
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
    const mockReveal: Reveal = [
      0, // fundingOutputIndex
      '0x' + 'b'.repeat(64), // blindingFactor
      '0x' + 'c'.repeat(40), // walletPublicKeyHash
      '0x' + 'd'.repeat(40), // refundPublicKeyHash
      ethers.BigNumber.from(Math.floor(Date.now() / 1000) + 3600).toHexString(), // refundLocktime as hex string
      '0xsomeTxId', // Not directly used by initializeDeposit but part of Reveal
    ];
    const mockL2Owner = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // Valid StarkNet address
    const mockL2Sender = '0x' + 'f'.repeat(40); // ETH-like address

    beforeEach(() => {
      // Create a fresh mock deposit for each test
      mockDeposit = mockDepositsUtil.createDeposit(
        mockFundingTx,
        mockReveal,
        mockL2Owner,
        mockL2Sender,
        mockStarknetConfig.chainName, // Ensure chainId matches handler's config
      );

      // Reset specific mock call counts or resolved values if they are modified within tests
      mockContractInstance.initializeDeposit.mockClear();
      mockDepositsUtil.updateToInitializedDeposit.mockClear();
      mockAuditLogUtil.logDepositError.mockClear();
      mockAuditLogUtil.logStatusChange.mockClear();
      (DepositStore.update as jest.Mock).mockClear();

      // Ensure default success for contract calls unless overridden by a specific test
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
        (addr) => addr as string, // Or the actual formatting logic if crucial
      );
    });

    it('should successfully initialize a deposit and return the transaction receipt', async () => {
      const result = await handler.initializeDeposit(mockDeposit);

      expect(result).toBeDefined();
      expect(result?.transactionHash).toBe('0xInitTxHashSuccess');
      expect(result?.status).toBe(1);

      expect(mockContractInstance.initializeDeposit).toHaveBeenCalledTimes(1);
      const expectedFormattedOwner =
        mockStarknetAddress.formatStarkNetAddressForContract(mockL2Owner);
      expect(mockContractInstance.initializeDeposit).toHaveBeenCalledWith(
        [
          mockFundingTx.version,
          mockFundingTx.inputVector,
          mockFundingTx.outputVector,
          mockFundingTx.locktime,
        ],
        mockReveal.slice(0, 5), // Solidity bytes[5]
        expectedFormattedOwner,
        {}, // Expect empty Overrides object as per non-payable ABI
      );

      expect(mockDepositsUtil.updateToInitializedDeposit).toHaveBeenCalledTimes(1);
      expect(mockDepositsUtil.updateToInitializedDeposit).toHaveBeenCalledWith(
        expect.objectContaining({ id: mockDeposit.id }),
        expect.objectContaining({ transactionHash: '0xInitTxHashSuccess' }),
      );
      expect(mockDeposit.hashes.eth.initializeTxHash).toBe('0xInitTxHashSuccess'); // Optimistic update check
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
        { address: mockL2Owner },
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
        `Error during L1 initializeDeposit: ${errorMessage}`,
        expect.any(Error),
      );
    });
  });

  describe('finalizeDeposit', () => {
    let mockDeposit: Deposit;
    const mockL2TxHash = '0xL2FinalizeTxHash';

    beforeEach(() => {
      // Create a base mock deposit for finalizeDeposit tests
      // It should typically be in a state like INITIALIZED or PENDING_L2_CONFIRMATION
      // and have necessary starknet L2 hash.
      mockDeposit = mockDepositsUtil.createDeposit(
        {
          version: '1',
          inputVector: '0xinput',
          outputVector: '0xoutput',
          locktime: '0',
        } as FundingTransaction, // Cast to satisfy type, actual values not critical for these tests
        [
          0,
          '0xblinding',
          '0xwalletKeyHash',
          '0xrefundKeyHash',
          ethers.BigNumber.from(Math.floor(Date.now() / 1000) + 7200).toHexString(),
          '0xtxId',
        ] as Reveal, // Cast, actual values less critical
        '0xStarknetOwner', // l2DepositOwner
        '0xEthSender', // l2Sender
        mockStarknetConfig.chainName,
      );
      mockDeposit.status = DepositStatus.INITIALIZED; // Or a more appropriate pre-finalization status

      // Ensure all hash structures are present as per Deposit type
      mockDeposit.hashes = {
        ...mockDeposit.hashes, // Spread existing hashes (btc, eth, starknet from createDeposit mock)
        solana: { bridgeTxHash: null }, // Explicitly add solana
        // Ensure starknet is also correctly structured if createDeposit mock is minimal
        starknet: {
          ...(mockDeposit.hashes.starknet || {}), // Spread existing starknet or default to empty object
          l1BridgeTxHash: mockDeposit.hashes.starknet?.l1BridgeTxHash || null,
          l2TxHash: mockL2TxHash, // Set l2TxHash needed for these tests
        },
      };

      mockDeposit.id = mockDepositsUtil.getDepositId(
        mockGetTransactionHashUtil.getFundingTxHash(mockDeposit.L1OutputEvent.fundingTx),
        mockDeposit.L1OutputEvent.reveal[0],
      );

      // Reset specific mock call counts or resolved values
      mockContractInstance.finalizeDeposit.mockClear();
      mockDepositsUtil.updateToFinalizedDeposit.mockClear();
      mockAuditLogUtil.logDepositError.mockClear();

      // Default success for contract calls
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
      const mockL2TxHash = '0xL2FinalizeTxHash';
      const mockDeposit = {
        id: 'deposit-0xfundingtxhash-0_mocked_in_create_deposit_too',
        L1OutputEvent: {
          fundingTx: { version: '1', inputVector: '0x01', outputVector: '0x01', locktime: '0' },
          reveal: [0, '0xbb', '0xcc', '0xdd', '0xee'],
        },
        hashes: { starknet: { l2TxHash: mockL2TxHash } },
      } as unknown as Deposit;

      const depositId = mockDepositsUtil.getDepositId(
        mockGetTransactionHashUtil.getFundingTxHash(mockDeposit.L1OutputEvent.fundingTx),
        mockDeposit.L1OutputEvent.reveal[0],
      );

      const mockFee = ethers.BigNumber.from('100000000000000'); // Example fee
      mockContractInstance.quoteFinalizeDeposit.mockResolvedValue(mockFee);

      const result = await handler.finalizeDeposit(mockDeposit);

      expect(result).toBeDefined();
      expect(result?.transactionHash).toBe('0xFinalizeTxHashSuccess');
      expect(result?.status).toBe(1);

      expect(mockContractInstance.finalizeDeposit).toHaveBeenCalledTimes(1);
      expect(mockContractInstance.finalizeDeposit).toHaveBeenCalledWith(
        depositId, // First argument is the depositId
        { value: mockFee }, // Second argument is the txOverrides with the fee
      );

      expect(mockDepositsUtil.updateToFinalizedDeposit).toHaveBeenCalledTimes(1);
      expect(mockDepositsUtil.updateToFinalizedDeposit).toHaveBeenCalledWith(
        mockDeposit,
        expect.objectContaining({ transactionHash: '0xFinalizeTxHashSuccess' }),
      );
    });

    it('should return undefined and log error if L1 Depositor contract is not available', async () => {
      (handler as any).l1DepositorContract = undefined;

      const result = await handler.finalizeDeposit(mockDeposit);

      expect(result).toBeUndefined();
      expect(mockAuditLogUtil.logDepositError).toHaveBeenCalledWith(
        mockDeposit.id,
        'L1 Depositor contract (signer) instance not available for finalization.',
        { internalError: 'L1 Depositor contract (signer) not available' },
      );
      expect(mockContractInstance.finalizeDeposit).not.toHaveBeenCalled();
    });

    it('should return undefined and log error if deposit is missing L2 transaction hash', async () => {
      mockDeposit.hashes.starknet!.l2TxHash = null; // Remove L2 tx hash

      const result = await handler.finalizeDeposit(mockDeposit);

      expect(result).toBeUndefined();
      expect(mockAuditLogUtil.logDepositError).toHaveBeenCalledWith(
        mockDeposit.id,
        'Deposit missing L2 transaction hash. L2 minting not confirmed before L1 finalization attempt.',
        { currentStatus: mockDeposit.status },
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

      const result = await handler.finalizeDeposit(mockDeposit);

      expect(result).toBeUndefined();
      expect(mockAuditLogUtil.logDepositError).toHaveBeenCalledWith(
        mockDeposit.id,
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

      const result = await handler.finalizeDeposit(mockDeposit);

      expect(result).toBeUndefined();
      expect(mockAuditLogUtil.logDepositError).toHaveBeenCalledWith(
        mockDeposit.id,
        `Error during L1 finalizeDeposit: ${errorMessage}`,
        expect.any(Error),
      );
    });
  });

  describe('processDepositBridgedToStarkNetEvent', () => {
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

      // const processEventMethod = (handler as any).processDepositBridgedToStarkNetEvent.bind(handler);
      // Call directly to avoid potential issues with bind or 'this' context in mocks
      await (handler as any).processDepositBridgedToStarkNetEvent(
        mockDepositKey,
        mockAmount,
        mockStarkNetRecipient.toString(),
        mockMessageNonce, // Added mockMessageNonce
        mockL1TxHash, // This is '0xL1BridgeEventTxHash'
        false, // isPastEvent = false
      );

      expect(mockDepositStore.update).toHaveBeenCalledTimes(1);
      const updatedDepositArgument = mockDepositStore.update.mock.calls[0][0] as Deposit;

      // console.log('DEBUGGING TEST - updatedDepositArgument.hashes.starknet:', updatedDepositArgument.hashes.starknet);
      expect(updatedDepositArgument.status).toBe(DepositStatus.BRIDGED);
      expect(updatedDepositArgument.hashes.starknet?.l1BridgeTxHash).toBe(mockL1TxHash);
      expect(updatedDepositArgument.dates.bridgedAt).toBeDefined();
      expect(updatedDepositArgument.dates.bridgedAt).toBeGreaterThanOrEqual(
        Math.floor((Date.now() - 1000) / 1000),
      ); // Check it's a recent timestamp
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          `LiveEvent | DepositBridgedToStarkNet for ${mockStarknetConfig.chainName}: Processing | DepositId: ${mockDepositKey}`,
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
      const processEventMethod = (handler as any).processDepositBridgedToStarkNetEvent.bind(
        handler,
      );
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
      const processEventMethod = (handler as any).processDepositBridgedToStarkNetEvent.bind(
        handler,
      );
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

      // const processEventMethod = (handler as any).processDepositBridgedToStarkNetEvent.bind(handler);
      // Call directly
      await (handler as any).processDepositBridgedToStarkNetEvent(
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
          `PastEvent | DepositBridgedToStarkNet for ${mockStarknetConfig.chainName}: Deposit already BRIDGED. ID: ${mockDepositKey}. Skipping update.`,
        ),
      );
    });

    it('should log an error and skip if deposit chainId does not match handler chainId', async () => {
      mockEventDeposit.chainId = 'DIFFERENT_CHAIN';
      mockDepositStore.getById.mockResolvedValue(mockEventDeposit);
      const processEventMethod = (handler as any).processDepositBridgedToStarkNetEvent.bind(
        handler,
      );
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
    let actualDepositId: string; // Will hold the ID generated by actualGetDepositId

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
          reveal: [0, '', '', '', '', ''],
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
