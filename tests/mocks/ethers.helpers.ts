// tests/mocks/ethers.helpers.ts
// This file contains shared helper mock instances and constructors for ethers mocking.

import type * as ethers from 'ethers';

// This is the actual ethers.BigNumber for constructing mock BigNumber values internally if needed,
// but the mock BigNumber object itself will be a different structure.
// const actualEthersBigNumber = jest.requireActual('ethers').BigNumber;

// Mock for an Ethers TransactionReceipt
export const mockEthersReceipt = {
  to: '0xReceiverAddress',
  from: '0xSenderAddress',
  contractAddress: '0xContractAddress', // Can be null if not a contract creation
  transactionIndex: 1,
  gasUsed: BigInt(21000), // Use BigInt for internal representation if consistent
  logsBloom: '0x' + '0'.repeat(512), // 256 bytes of zeros
  blockHash: '0xMockBlockHash',
  transactionHash: '0xMockL1TxHash',
  logs: [], // Populate with mock logs if needed by tests
  blockNumber: 1234567,
  confirmations: 10,
  cumulativeGasUsed: BigInt(100000),
  effectiveGasPrice: BigInt(20000000000), // 20 gwei
  byzantium: true,
  type: 0, // Legacy transaction type
  status: 1, // 1 for success, 0 for failure
  root: '0xMockRootHash',
};

export interface MockProvider {
  getBlockNumber: jest.Mock<Promise<number>>;
  getGasPrice: jest.Mock<Promise<bigint>>; // Use bigint for internal consistency
  getNetwork: jest.Mock<Promise<ethers.providers.Network>>;
  // Add other provider methods if they are called and need mocking
  getBalance: jest.Mock<Promise<bigint>>;
  getTransactionCount: jest.Mock<Promise<number>>;
  estimateGas: jest.Mock<Promise<bigint>>;
  call: jest.Mock<Promise<string>>;
  sendTransaction: jest.Mock<Promise<{ hash: string; wait: () => Promise<any> }>>;
  getFeeData: jest.Mock<Promise<any>>;
  resolveName: jest.Mock<Promise<string | null>>;
  getTransactionReceipt: jest.Mock<Promise<ethers.providers.TransactionReceipt | null>>;
}

export const mockJsonRpcProviderInstance: MockProvider = {
  getBlockNumber: jest.fn().mockResolvedValue(12345),
  getGasPrice: jest.fn().mockResolvedValue(BigInt('20000000000')), // 20 gwei
  getNetwork: jest.fn().mockResolvedValue({
    name: 'homestead',
    chainId: 1,
    ensAddress: null,
    _defaultProvider: expect.any(Function),
  } as unknown as ethers.providers.Network),
  getBalance: jest.fn().mockResolvedValue(BigInt('1000000000000000000')), // 1 ETH
  getTransactionCount: jest.fn().mockResolvedValue(0),
  estimateGas: jest.fn().mockResolvedValue(BigInt('21000')),
  call: jest.fn().mockResolvedValue('0x'),
  sendTransaction: jest
    .fn()
    .mockResolvedValue({ hash: '0xSentTxHash', wait: () => Promise.resolve(mockEthersReceipt) }),
  getFeeData: jest.fn().mockResolvedValue({ gasPrice: BigInt('20000000000') }),
  resolveName: jest.fn().mockResolvedValue(null), // Default to null for ENS
  getTransactionReceipt: jest.fn().mockResolvedValue(mockEthersReceipt),
};

export const mockJsonRpcProviderConstructor = jest
  .fn()
  .mockImplementation((_url?: string, _network?: any) => mockJsonRpcProviderInstance);

export const mockEthersWalletInstance = {
  _isSigner: true, // Important for ethers v5 type checks
  address: '0xMockSignerAddress',
  provider: mockJsonRpcProviderInstance,
  connect: jest.fn(function (this: any, provider) {
    this.provider = provider;
    return this;
  }),
  getAddress: jest.fn().mockResolvedValue('0xMockSignerAddress'),
  signMessage: jest.fn().mockResolvedValue('0xMockSignature'),
  signTransaction: jest.fn().mockResolvedValue('0xMockSignedTx'),
  getBalance: jest.fn().mockResolvedValue(BigInt('5000000000000000000')), // 5 ETH
  getTransactionCount: jest.fn().mockResolvedValue(10),
  sendTransaction: jest.fn().mockResolvedValue({
    hash: '0xWalletSentTxHash',
    wait: jest.fn().mockResolvedValue(mockEthersReceipt),
  }),
  // Add other commonly used Wallet methods if needed
  getChainId: jest.fn().mockResolvedValue(1),
  getGasPrice: jest.fn().mockResolvedValue(BigInt('20000000000')),
  estimateGas: jest.fn().mockResolvedValue(BigInt('21000')),
  call: jest.fn().mockResolvedValue('0x'),
  populateTransaction: jest.fn().mockImplementation(async (tx) => tx),
  getFeeData: jest.fn().mockResolvedValue({ gasPrice: BigInt('20000000000') }),
  resolveName: jest.fn().mockResolvedValue(null),
  _checkProvider: jest.fn(),
  checkTransaction: jest.fn(),
};

export const mockEthersWalletConstructor = jest
  .fn()
  .mockImplementation((privateKey?: string, provider?: any) => {
    const instance = { ...mockEthersWalletInstance };
    if (provider) {
      instance.provider = provider;
    }
    // If privateKey is used to derive address in a real scenario, mock that if tests depend on it.
    // For now, address is hardcoded in mockEthersWalletInstance.
    return instance;
  });

// This is the mock for the *instance* returned by `new ethers.Contract(...)`
// It defines the methods our SUT (StarknetChainHandler) calls on contract instances.
export const mockContractSpyReturnInstance = {
  // L1Depositor methods
  initializeDeposit: jest.fn().mockResolvedValue({
    hash: '0xMockL1TxHashInitializeDeposit',
    wait: jest.fn().mockResolvedValue(mockEthersReceipt),
  }),
  finalizeDeposit: jest.fn().mockResolvedValue({
    hash: '0xMockL1TxHashFinalizeDeposit',
    wait: jest.fn().mockResolvedValue(mockEthersReceipt),
  }),
  quoteFinalizeDepositDynamic: jest.fn().mockResolvedValue(BigInt(100000)), // Example fee
  quoteFinalizeDeposit: jest.fn().mockResolvedValue(BigInt(120000)), // Example fee

  // L1StarkNetMessageBridge methods (if used by the same contract mock variable)
  l1ToL2MessageFee: jest.fn().mockResolvedValue(BigInt('500000000000000')), // Example fee 0.0005 ETH

  // Common contract methods
  connect: jest.fn(function (this: any, signerOrProvider) {
    // This mock needs to return `this` or a new instance with the new signer/provider
    // For simplicity, modify in place, though a new instance is often cleaner
    if (signerOrProvider._isSigner) {
      this.signer = signerOrProvider;
      this.provider = signerOrProvider.provider || this.provider;
    } else {
      this.provider = signerOrProvider;
    }
    return this; // Return the same instance
  }),
  on: jest.fn(),
  off: jest.fn(),
  removeAllListeners: jest.fn(),
  queryFilter: jest.fn().mockResolvedValue([]), // Default to empty array for events
  filters: {
    DepositInitialized: jest.fn().mockReturnValue({ filterId: 'depositInitializedFilterId' }),
    TBTCBridgedToStarkNet: jest.fn().mockReturnValue({ filterId: 'tbtcBridgedToStarkNetFilterId' }),
    // Add other event filters if used
  },
  provider: mockJsonRpcProviderInstance, // Default provider
  signer: mockEthersWalletInstance, // Default signer (can be overridden by connect)
  address: '0xDefaultContractAddress',
  // Add other methods/properties if StarknetChainHandler or other parts expect them
  // e.g., interface: jest.fn(), estimateGas: { initializeDeposit: jest.fn(), ... }
  estimateGas: {
    initializeDeposit: jest.fn().mockResolvedValue(BigInt('150000')),
    finalizeDeposit: jest.fn().mockResolvedValue(BigInt('200000')),
    // etc.
  },
  interface: {
    getEvent: jest.fn().mockReturnValue({ name: 'MockEventFromInterface' }),
    // Add other ethers.utils.Interface methods if necessary
  },
};
