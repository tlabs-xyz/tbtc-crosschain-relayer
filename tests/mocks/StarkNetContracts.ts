import { BigNumber, ethers } from 'ethers';
import type { IStarkGateBridge } from '../../interfaces/IStarkGateBridge';
import type {
  BytesLike,
  ContractTransaction,
  BigNumberish,
  ContractReceipt,
  EventFilter,
  Signer,
  ContractFunction,
} from 'ethers';
import type {
  Block,
  TransactionRequest,
  TransactionResponse,
  Provider,
  FeeData,
  BlockWithTransactions,
} from '@ethersproject/abstract-provider';
import type { Deferrable } from '@ethersproject/properties';
import { EventEmitter } from 'events';

// --- Minimal, but complete, mock Signer and Provider ---

const mockSigner: Signer = {
  provider: undefined, // Changed from null to undefined to match Signer interface
  _isSigner: true,

  // Required methods from ethers.Signer (ethers v5)
  getAddress: jest.fn(() => Promise.resolve(ethers.constants.AddressZero)),
  signMessage: jest.fn(() => Promise.resolve('0xMockSignature')),
  signTransaction: jest.fn(() => Promise.resolve('0xMockSignedTransaction')),
  sendTransaction: jest.fn(async (transaction: Deferrable<TransactionRequest>) => {
    return {
      hash: '0xMockTxHash' + Date.now(),
      from: ethers.constants.AddressZero,
      gasLimit: BigNumber.from(0),
      gasPrice: BigNumber.from(0),
      nonce: 0,
      value: BigNumber.from(transaction.value || 0),
      data: transaction.data?.toString() || '0x',
      chainId: transaction.chainId || 1,
      confirmations: 0,
      wait: jest.fn(
        async () => ({ status: 1, logsBloom: '0x' + '0'.repeat(512) }) as ContractReceipt,
      ),
    } as TransactionResponse;
  }),
  connect: jest.fn(() => mockSigner),
  resolveName: jest.fn(() => Promise.resolve(ethers.constants.AddressZero)),
  checkTransaction: jest.fn((tx: Deferrable<TransactionRequest>) => tx as TransactionRequest), // Correct return type for checkTransaction
  populateTransaction: jest.fn((tx: Deferrable<TransactionRequest>) =>
    Promise.resolve(tx as TransactionRequest),
  ),
  estimateGas: jest.fn(() => Promise.resolve(BigNumber.from(0))),
  call: jest.fn(() => Promise.resolve('0x')),
  getChainId: jest.fn(() => Promise.resolve(1)),
  getFeeData: jest.fn(() =>
    Promise.resolve({
      gasPrice: BigNumber.from(0),
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
      lastBaseFeePerGas: null,
    } as FeeData),
  ),
  getBalance: jest.fn(() => Promise.resolve(BigNumber.from(0))),
  getTransactionCount: jest.fn(() => Promise.resolve(0)),
  getGasPrice: jest.fn(() => Promise.resolve(BigNumber.from(0))),
  _checkProvider: jest.fn(() => {}),
};

const mockProvider: Provider = {
  _isProvider: true,
  // Required methods on Provider
  getBlockNumber: jest.fn(() => Promise.resolve(12345)),
  getNetwork: jest.fn(() => Promise.resolve({ chainId: 1, name: 'mock-network' })),
  on: jest.fn(),
  off: jest.fn(),
  once: jest.fn(),
  emit: jest.fn(),
  addListener: jest.fn(),
  removeListener: jest.fn(),
  removeAllListeners: jest.fn(),
  listenerCount: jest.fn(() => 0),
  listeners: jest.fn(() => []),
  // Additional methods to complete Provider interface
  getGasPrice: jest.fn(() => Promise.resolve(BigNumber.from(0))),
  getFeeData: jest.fn(() =>
    Promise.resolve({
      gasPrice: BigNumber.from(0),
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
      lastBaseFeePerGas: null,
    } as FeeData),
  ),
  estimateGas: jest.fn(() => Promise.resolve(BigNumber.from(0))),
  sendTransaction: jest.fn(
    async (signedTransaction: string) => ({ hash: signedTransaction }) as TransactionResponse,
  ),
  call: jest.fn(() => Promise.resolve('0x')),
  getCode: jest.fn(() => Promise.resolve('0x')),
  getStorageAt: jest.fn(() => Promise.resolve('0x')),
  getBalance: jest.fn(() => Promise.resolve(BigNumber.from(0))),
  getTransactionCount: jest.fn(() => Promise.resolve(0)),
  getBlock: jest.fn(() => Promise.resolve(null as unknown as Block)),
  getTransaction: jest.fn(() => Promise.resolve(null as unknown as TransactionResponse)),
  getTransactionReceipt: jest.fn(() => Promise.resolve(null as unknown as ContractReceipt)),
  waitForTransaction: jest.fn(() => Promise.resolve({} as ContractReceipt)),
  resolveName: jest.fn(() => Promise.resolve(ethers.constants.AddressZero)),
  lookupAddress: jest.fn(() => Promise.resolve(ethers.constants.AddressZero)),
  // More methods commonly found on ethers.providers.Provider (ethers v5)
  getBlockWithTransactions: jest.fn(() =>
    Promise.resolve({
      transactions: [], // Ensure transactions array is of type TransactionResponse[]
      blockHash: '0xMockBlockHash',
      blockNumber: 12345,
      parentHash: '0x',
      timestamp: Date.now() / 1000,
      nonce: '0x',
      difficulty: 0,
      gasLimit: BigNumber.from(0),
      gasUsed: BigNumber.from(0),
      miner: ethers.constants.AddressZero,
      extraData: '0x',
      baseFeePerGas: null,
      hash: '0xMockBlockHash',
      logsBloom: '0x' + '0'.repeat(512),
      receiptsRoot: '0x',
      stateRoot: '0x',
      transactionsRoot: '0x',
      _difficulty: BigNumber.from(0),
      totalDifficulty: BigNumber.from(0),
      size: 0,
    } as unknown as BlockWithTransactions),
  ), // Cast to BlockWithTransactions
  getLogs: jest.fn(() => Promise.resolve([])),
};

// Mock implementation of the IStarkGateBridge interface.
export class MockStarkGateBridge extends EventEmitter implements IStarkGateBridge {
  // Directly implement the properties from IStarkGateBridge
  readonly address: string;
  readonly interface: ethers.utils.Interface;
  readonly signer: Signer | null;
  readonly provider: Provider | null;

  // Methods from IStarkGateBridge
  initializeDeposit: jest.Mock<Promise<ContractTransaction>>;
  finalizeDeposit: jest.Mock<Promise<ContractTransaction>>;
  quoteFinalizeDeposit: jest.Mock<Promise<BigNumber>>;
  l1ToL2MessageFee: jest.Mock<Promise<BigNumber>>;
  updateL1ToL2MessageFee: jest.Mock<Promise<ContractTransaction>>;
  
  // New methods from updated IStarkGateBridge
  deposit: jest.Mock<Promise<ContractTransaction>>;
  depositWithMessage: jest.Mock<Promise<ContractTransaction>>;
  estimateMessageFee: jest.Mock<Promise<BigNumber>>;
  depositWithMessageCancelRequest: jest.Mock<Promise<ContractTransaction>>;
  l1ToL2MessageNonce: jest.Mock<Promise<BigNumber>>;
  isDepositCancellable: jest.Mock<Promise<boolean>>;

  // Event listener methods from IStarkGateBridge
  on: jest.Mock;
  once: jest.Mock;
  off: jest.Mock;
  removeAllListeners: jest.Mock;
  listeners: jest.Mock;
  listenerCount: jest.Mock;

  // Filters property from IStarkGateBridge
  readonly filters: {
    TBTCBridgedToStarkNet: (
      depositKey?: BytesLike | null,
      starkNetRecipient?: BigNumberish | null,
      amount?: null,
      messageNonce?: null,
    ) => EventFilter;
  };

  // Properties also expected by IStarkGateBridge (derived from ethers.Contract)
  readonly callStatic: { [key: string]: ContractFunction };
  readonly estimateGas: { [key: string]: ContractFunction };
  readonly populateTransaction: { [key: string]: ContractFunction };
  readonly resolvedAddress: Promise<string>;
  readonly functions: { [key: string]: ContractFunction };
  readonly deployed: () => Promise<ethers.Contract>; // Match IStarkGateBridge
  readonly deployTransaction: ContractTransaction | undefined; // Match IStarkGateBridge

  constructor(address: string = ethers.constants.AddressZero) {
    super();
    this.address = address;
    this.interface = new ethers.utils.Interface([]); // Minimal interface
    this.signer = mockSigner; // Assign the mock signer
    this.provider = mockProvider; // Assign the mock provider

    // Initialize the specific method mocks from IStarkGateBridge
    this.initializeDeposit = jest.fn(async () => this.createMockTransactionResponse());
    this.finalizeDeposit = jest.fn(async () => this.createMockTransactionResponse());
    this.quoteFinalizeDeposit = jest.fn(async () =>
      BigNumber.from(ethers.utils.parseUnits('100', 'gwei')),
    );
    this.l1ToL2MessageFee = jest.fn(async () =>
      BigNumber.from(ethers.utils.parseUnits('50', 'gwei')),
    );
    this.updateL1ToL2MessageFee = jest.fn(async () => this.createMockTransactionResponse());
    
    // Initialize new method mocks from updated IStarkGateBridge
    this.deposit = jest.fn(async () => this.createMockTransactionResponse());
    this.depositWithMessage = jest.fn(async () => this.createMockTransactionResponse());
    this.estimateMessageFee = jest.fn(async () => 
      BigNumber.from(ethers.utils.parseUnits('75', 'gwei')),
    );
    this.depositWithMessageCancelRequest = jest.fn(async () => this.createMockTransactionResponse());
    this.l1ToL2MessageNonce = jest.fn(async () => BigNumber.from(123));
    this.isDepositCancellable = jest.fn(async () => false);

    // Initialize the `filters` object with our specific event filter mock
    this.filters = {
      TBTCBridgedToStarkNet: jest.fn(
        (depositKey?: BytesLike | null, starkNetRecipient?: BigNumberish | null, amount?: null, messageNonce?: null) => {
          const topics: (string | string[])[] = [
            ethers.utils.id('TBTCBridgedToStarkNet(bytes32,uint256,uint256,uint256)'),
          ];
          if (depositKey) {
            topics.push(ethers.utils.hexZeroPad(depositKey.toString(), 32));
          }
          if (starkNetRecipient) {
            topics.push(ethers.utils.hexZeroPad(starkNetRecipient.toString(), 32));
          }
          return {
            topics: topics,
            address: this.address,
          };
        },
      ),
    };

    // Bind EventEmitter methods to jest.fn() for spying/controlling them
    this.on = jest.fn(this.on.bind(this));
    this.once = jest.fn(this.once.bind(this));
    this.off = jest.fn(this.off.bind(this));
    this.removeAllListeners = jest.fn(this.removeAllListeners.bind(this));
    this.listeners = jest.fn(this.listeners.bind(this));
    this.listenerCount = jest.fn(this.listenerCount.bind(this));

    // Initialize other properties from IStarkGateBridge (derived from ethers.Contract)
    this.callStatic = {};
    this.estimateGas = {};
    this.populateTransaction = {};
    this.resolvedAddress = Promise.resolve(this.address);
    this.functions = {};
    this.deployed = jest.fn(() => Promise.resolve(this as unknown as ethers.Contract)); // Return `this` cast to ethers.Contract
    this.deployTransaction = undefined;
  }

  // Helper for mock transaction response (remains largely the same)
  createMockTransactionResponse(hash: string = '0xMockTxHash' + Date.now()): ContractTransaction {
    return {
      hash: hash,
      confirmations: 0,
      from: ethers.constants.AddressZero,
      gasLimit: BigNumber.from(0),
      gasPrice: BigNumber.from(0),
      nonce: 0,
      value: BigNumber.from(0),
      data: '0x',
      chainId: 1,
      wait: jest.fn(async (confirmations?: number) => {
        const receipt: ContractReceipt = {
          blockHash: '0xMockBlockHash' + Date.now(),
          blockNumber: 12345,
          confirmations: confirmations || 1,
          contractAddress: ethers.constants.AddressZero,
          cumulativeGasUsed: BigNumber.from(0),
          effectiveGasPrice: BigNumber.from(0),
          from: ethers.constants.AddressZero,
          gasUsed: BigNumber.from(0),
          logs: [],
          byzantium: true,
          status: 1,
          to: this.address,
          transactionHash: hash,
          transactionIndex: 0,
          type: 0,
          events: [],
          root: undefined,
          logsBloom: '0x' + '0'.repeat(512),
        };
        return receipt;
      }),
    };
  }

  // Helper method to simulate emitting a TBTCBridgedToStarkNet event for tests
  emitTBTCBridgedToStarkNet(depositKey: string, starkNetRecipient: BigNumberish, amount: BigNumberish, messageNonce: BigNumberish = 123) {
    this.emit('TBTCBridgedToStarkNet', depositKey, BigNumber.from(starkNetRecipient), BigNumber.from(amount), BigNumber.from(messageNonce), {});
  }
}
