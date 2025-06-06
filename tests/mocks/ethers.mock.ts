// tests/mocks/ethers.mock.ts
// This file will mock the 'ethers' module globally via moduleNameMapper in jest.config.cjs

// Helper mocks are imported from the test file for now. This is not ideal long-term.
import {
  mockContractSpyReturnInstance,
  mockJsonRpcProviderConstructor,
  mockJsonRpcProviderInstance,
} from './ethers.helpers.js';

// --- BEGIN ADDED INTERFACE ---
interface MockBigNumber {
  _isBigNumber: true;
  _value: bigint;
  add(other: any): MockBigNumber;
  sub(other: any): MockBigNumber;
  mul(other: any): MockBigNumber;
  div(other: any): MockBigNumber;
  mod(other: any): MockBigNumber;
  pow(other: any): MockBigNumber;
  abs(): MockBigNumber;
  toString(): string;
  toNumber(): number;
  toHexString(): string;
  eq(other: any): boolean;
  lt(other: any): boolean;
  lte(other: any): boolean;
  gt(other: any): boolean;
  gte(other: any): boolean;
  isZero(): boolean;
  isNegative(): boolean;
  fromTwos(bits: number): MockBigNumber;
  toTwos(bits: number): MockBigNumber;
}
// --- END ADDED INTERFACE ---

const internalEthersContractMock = jest
  .fn()
  .mockImplementation((addressOrName, contractInterface, signerOrProviderUntyped) => {
    const signerOrProvider = signerOrProviderUntyped as
      | any
      | { _isSigner: boolean; provider: any | null }
      | undefined;

    const instance: any = {
      address: addressOrName as string,
      provider: null,
      signer: null,
      initializeDeposit: mockContractSpyReturnInstance.initializeDeposit,
      finalizeDeposit: mockContractSpyReturnInstance.finalizeDeposit,
      quoteFinalizeDepositDynamic: mockContractSpyReturnInstance.quoteFinalizeDepositDynamic,
      quoteFinalizeDeposit: mockContractSpyReturnInstance.quoteFinalizeDeposit,
      l1ToL2MessageFee: mockContractSpyReturnInstance.l1ToL2MessageFee,
      on: mockContractSpyReturnInstance.on,
      off: mockContractSpyReturnInstance.off,
      removeAllListeners: mockContractSpyReturnInstance.removeAllListeners,
      queryFilter: mockContractSpyReturnInstance.queryFilter,
      getSignedVAA: jest.fn(),
      filters: {
        DepositInitialized: jest.fn(
          mockContractSpyReturnInstance.filters.DepositInitialized.getMockImplementation(),
        ),
        TBTCBridgedToStarkNet: jest.fn(
          mockContractSpyReturnInstance.filters.TBTCBridgedToStarkNet.getMockImplementation(),
        ),
      },
    };

    if (signerOrProvider && (signerOrProvider as { _isSigner: boolean })._isSigner) {
      instance.signer = signerOrProvider;
      instance.provider =
        (signerOrProvider as { provider: any | null }).provider || mockJsonRpcProviderInstance;
    } else if (signerOrProvider) {
      instance.signer = null;
      if (typeof (signerOrProvider as any).getBlockNumber === 'function') {
        instance.provider = signerOrProvider as any;
      } else {
        instance.provider = mockJsonRpcProviderInstance;
      }
    } else {
      instance.signer = null;
      instance.provider = mockJsonRpcProviderInstance;
    }

    instance.connect = jest
      .fn(function (this: typeof instance, newSignerOrProvider) {
        if ((newSignerOrProvider as any)._isSigner) {
          this.signer = newSignerOrProvider;
          this.provider = (newSignerOrProvider as any).provider || this.provider;
        } else {
          this.provider = newSignerOrProvider;
        }
        return this;
      })
      .mockName(`connectMock_${addressOrName}`);

    console.log(
      'ETHERS_MOCK_FILE: ethers.Contract mock constructor called. typeof instance.initializeDeposit:',
      typeof instance.initializeDeposit,
    );
    console.log(
      'ETHERS_MOCK_FILE: instance.initializeDeposit === mockContractSpyReturnInstance.initializeDeposit:',
      instance.initializeDeposit === mockContractSpyReturnInstance.initializeDeposit,
    );
    return instance;
  });

console.log('ETHERS_MOCK_FILE: tests/mocks/ethers.mock.ts loaded by Jest.');

export const Contract = internalEthersContractMock;

// Updated Wallet mock to include static createRandom
const mockWalletInstance = {
  // Instance properties and methods from mockEthersWalletConstructor helper
  // These are typically what mockEthersWalletConstructor would set up on an instance
  _isSigner: true,
  address: '0xMockWalletAddress',
  provider: mockJsonRpcProviderInstance,
  connect: jest.fn(function (this: any, provider: any) {
    this.provider = provider;
    return this;
  }),
  getAddress: jest.fn().mockResolvedValue('0xMockWalletAddress'),
  signMessage: jest.fn().mockResolvedValue('0xMockSignedMessage'),
  signTransaction: jest.fn().mockResolvedValue('0xMockSignedTransaction'),
  sendTransaction: jest.fn().mockResolvedValue({
    hash: '0xMockSentTxHash',
    wait: jest.fn().mockResolvedValue({ status: 1, transactionHash: '0xMockSentTxHash' }),
  }),
  privateKey: '0xMockPrivateKey',
  publicKey: '0xMockPublicKey',
  mnemonic: { phrase: 'mock mnemonic phrase' },
  // Add any other methods/properties that mockEthersWalletConstructor instances have
};

export const Wallet = jest.fn((privateKey?: string, provider?: any) => {
  // This is the constructor mock part, deferring to mockEthersWalletConstructor's logic if needed,
  // or simply returning a pre-defined instance structure.
  // For simplicity here, let's assume it returns a structure similar to mockWalletInstance.
  // If mockEthersWalletConstructor is more complex, this might need adjustment.
  const instance = {
    ...mockWalletInstance, // Spread the common instance methods/properties
    address: privateKey ? '0xAddressFromKey-' + privateKey.slice(0, 10) : '0xNewMockWalletAddress',
    provider: provider || mockJsonRpcProviderInstance,
    privateKey: privateKey || '0xAnotherMockPrivateKey',
  };
  // If mockEthersWalletConstructor actually returns a jest.Mocked<ethers.Wallet> or similar,
  // we might want to call it here: return mockEthersWalletConstructor(privateKey, provider);
  return instance;
}) as any; // Use `as any` to attach static methods more easily to the Jest mock function

Wallet.createRandom = jest.fn((options?: any) => {
  // Return a new instance, similar to what the constructor mock does
  return {
    ...mockWalletInstance, // Spread the common instance methods/properties
    address: '0xRandomMockWalletAddress-' + Math.random().toString(36).substring(7),
    privateKey: '0xRandomMockPrivateKey-' + Math.random().toString(36).substring(7),
    provider: options?.provider || mockJsonRpcProviderInstance,
  };
});

Wallet.fromMnemonic = jest.fn((mnemonic: string, path?: string, wordlist?: any) => {
  return {
    ...mockWalletInstance,
    address: '0xMnemonicMockWalletAddress',
    privateKey: '0xMnemonicMockPrivateKey',
    mnemonic: { phrase: mnemonic, path: path || "m/44'/60'/0'/0/0", locale: wordlist || 'en' },
  };
});

export const providers = {
  JsonRpcProvider: mockJsonRpcProviderConstructor,
  StaticJsonRpcProvider: jest.fn(),
  InfuraProvider: jest.fn(),
  AlchemyProvider: jest.fn(),
  EtherscanProvider: jest.fn(),
  CloudflareProvider: jest.fn(),
  PocketProvider: jest.fn(),
  AnkrProvider: jest.fn(),
  QuickNodeProvider: jest.fn(),
  IpcProvider: jest.fn(),
  JsonRpcBatchProvider: jest.fn(),
  UrlJsonRpcProvider: jest.fn(),
  WebSocketProvider: jest.fn(),
  FallbackProvider: jest.fn(),
  getDefaultProvider: jest
    .fn()
    .mockImplementation((network?: any, options?: any) => mockJsonRpcProviderInstance),
};

// --- BEGIN ADDED TYPE FOR UTILS ---
type EthersUtilsMock = {
  getAddress: jest.Mock<string, [string]>;
  isAddress: jest.Mock<boolean, [string]>;
  isHexString: jest.Mock<boolean, [value: any, length?: number]>;
  hexZeroPad: jest.Mock<string, [value: string, length: number]>;
  keccak256: jest.Mock<string, [any]>;
  toUtf8Bytes: jest.Mock<Uint8Array, [string]>;
  solidityKeccak256: jest.Mock<string, [any[], any[]]>;
  formatUnits: jest.Mock<string, [any, any?]>;
  parseUnits: jest.Mock<MockBigNumber, [any, any?]>; // Assuming parseUnits returns our MockBigNumber
  parseEther: jest.Mock<MockBigNumber, [string]>;
  Interface: jest.Mock<any, [any]>; // This is complex, keeping it general for mock
  arrayify: jest.Mock<Uint8Array, [any]>;
  hexlify: jest.Mock<string, [any]>;
  concat: jest.Mock<Uint8Array, [any[]]>;
  AbiCoder: jest.Mock<any, []>;
  defaultAbiCoder: {
    encode: jest.Mock<string, [any[], any[]]>;
    decode: jest.Mock<any[], [any[], any]>;
  };
  Fragment: { from: jest.Mock<any, [any]> };
  FunctionFragment: { from: jest.Mock<any, [any]> };
  EventFragment: { from: jest.Mock<any, [any]> };
  ParamType: { from: jest.Mock<any, [any]> };
  nameprep: jest.Mock<string, [string]>;
  hashMessage: jest.Mock<string, [string | Uint8Array]>;
  id: jest.Mock<string, [string]>;
  isValidName: jest.Mock<boolean, [string]>;
  joinSignature: jest.Mock<string, [any]>;
  splitSignature: jest.Mock<{ r: string; s: string; v: number }, [any]>;
  verifyMessage: jest.Mock<string, [string | Uint8Array, any]>;
  verifyTypedData: jest.Mock<string, [any, any, any, any]>;
  computeAddress: jest.Mock<string, [any]>;
  recoverAddress: jest.Mock<string, [any, any]>;
  getContractAddress: jest.Mock<string, [any]>;
  randomBytes: jest.Mock<Uint8Array, [number]>;
};
// --- END ADDED TYPE FOR UTILS ---

export const utils: EthersUtilsMock = {
  getAddress: jest.fn((address) => address), // Basic passthrough
  isAddress: jest.fn().mockReturnValue(true),
  isHexString: jest.fn((value: any, length?: number) => {
    if (typeof value !== 'string' || !/^0x[0-9a-fA-F]*$/.test(value)) {
      return false;
    }
    // ethers.js: '0x' is not a valid hex string (must have at least one digit after 0x)
    if (value.length < 3) {
      return false;
    }
    if (typeof length === 'number') {
      const hexLength = value.length - 2;
      if (hexLength % 2 !== 0) return false; // Hex part must be even length for byte alignment
      return hexLength / 2 === length;
    }
    return true;
  }),
  hexZeroPad: jest.fn((value: string, length: number) => {
    let hex = value.startsWith('0x') ? value.substring(2) : value;
    const targetCharLength = length * 2;
    if (hex.length > targetCharLength) {
      hex = hex.substring(hex.length - targetCharLength); // Truncate from the left (keep right-most part)
    } else if (hex.length < targetCharLength) {
      hex = hex.padStart(targetCharLength, '0'); // Pad with leading zeros
    }
    return '0x' + hex;
  }),
  keccak256: jest.fn((data) => '0xmockKeccak256OfData'),
  toUtf8Bytes: jest.fn((str) => new TextEncoder().encode(str)),
  solidityKeccak256: jest.fn((types: string[], values: any[]) => {
    const fundingTxHash = values[0] || '0xdefaultHash';
    const fundingOutputIndex = values[1] || 0;
    const outputIndexHex = fundingOutputIndex.toString(16).padStart(62, '0');
    const txHashPart = fundingTxHash.length > 2 ? fundingTxHash.substring(2, 4) : '00';
    return `0x${txHashPart}${outputIndexHex}`;
  }),
  formatUnits: jest.fn((value, decimals) => {
    const d = Number(decimals || 18);
    try {
      return (Number(BigInt(value.toString())) / 10 ** d).toString();
    } catch {
      return String(Number(value) / 10 ** d);
    }
  }),
  parseUnits: jest.fn((value, decimals) => {
    // Map string units to decimals, as ethers.js does
    const unitMap: Record<string, number> = {
      wei: 0,
      kwei: 3,
      babbage: 3,
      femtoether: 3,
      mwei: 6,
      lovelace: 6,
      picoether: 6,
      gwei: 9,
      shannon: 9,
      nanoether: 9,
      nano: 9,
      szabo: 12,
      microether: 12,
      micro: 12,
      finney: 15,
      milliether: 15,
      milli: 15,
      ether: 18,
    };
    let d: bigint;
    if (typeof decimals === 'string') {
      if (unitMap[decimals] !== undefined) {
        d = BigInt(unitMap[decimals]);
      } else if (/^\d+$/.test(decimals)) {
        d = BigInt(decimals);
      } else {
        throw new SyntaxError(`Cannot convert ${decimals} to a BigInt`);
      }
    } else if (typeof decimals === 'number') {
      d = BigInt(decimals);
    } else if (decimals === undefined) {
      d = 18n;
    } else {
      throw new SyntaxError(`Cannot convert ${decimals} to a BigInt`);
    }
    const s = String(value);
    if (s.includes('.')) {
      const parts = s.split('.');
      const intPart = BigInt(parts[0]);
      const fracPart = parts[1].slice(0, Number(d));
      const fracBigInt = BigInt(fracPart.padEnd(Number(d), '0'));
      return BigNumber.from(intPart * 10n ** d + fracBigInt);
    }
    return BigNumber.from(BigInt(s) * 10n ** d);
  }),
  parseEther: jest.fn((ether: string) => {
    return utils.parseUnits(ether, 18);
  }),
  Interface: jest.fn().mockImplementation((abi) => ({
    format: jest.fn().mockReturnValue(abi),
    encodeFunctionData: jest.fn((fragment, args) => '0xmockEncodedFunctionData'),
    decodeFunctionResult: jest.fn((fragment, data) => ['mockDecodedResult']),
    parseLog: jest.fn(({ topics, data }) => ({
      name: 'MockEventName',
      signature: 'MockEvent()',
      topic: topics[0],
      args: [],
    })),
    getFunction: jest.fn().mockReturnValue({ format: jest.fn() }),
    getEvent: jest.fn().mockReturnValue({ format: jest.fn() }),
  })),
  arrayify: jest.fn((value) => {
    if (typeof value === 'string') {
      if (value.startsWith('0x')) {
        return Uint8Array.from(Buffer.from(value.substring(2), 'hex'));
      }
      return new TextEncoder().encode(value);
    }
    if (typeof value === 'number') {
      // very basic number to byte array
      const arr = new ArrayBuffer(8); // 64-bit number
      const view = new DataView(arr);
      view.setFloat64(0, value, false); // big-endian
      return new Uint8Array(arr);
    }
    if (value instanceof Uint8Array) return value;
    return Uint8Array.from(value as any); // Fallback
  }),
  hexlify: jest.fn((value): string => {
    if (typeof value === 'number') return '0x' + value.toString(16);
    return '0x' + Buffer.from(value as any).toString('hex');
  }),
  concat: jest.fn((items: any[]): Uint8Array => {
    const B: Buffer = items.reduce(
      (acc: Buffer, item: any): Buffer => Buffer.concat([acc, Buffer.from(utils.arrayify(item))]),
      Buffer.alloc(0),
    );
    return Uint8Array.from(B);
  }),
  AbiCoder: jest.fn(() => ({
    encode: jest.fn((types, values) => '0xmockEncodedAbi'),
    decode: jest.fn((types, data) => new Array(types.length).fill('mockDecodedAbiValue')),
  })),
  defaultAbiCoder: {
    encode: jest.fn((types, values) => '0xmockEncodedDefaultAbi'),
    decode: jest.fn((types, data) => new Array(types.length).fill('mockDecodedDefaultAbiValue')),
  },
  Fragment: {
    from: jest.fn((obj) => obj),
  },
  FunctionFragment: {
    from: jest.fn((obj) => ({ ...obj, format: jest.fn() })),
  },
  EventFragment: {
    from: jest.fn((obj) => ({ ...obj, format: jest.fn() })),
  },
  ParamType: {
    from: jest.fn((obj) => obj),
  },
  nameprep: jest.fn((str) => str),
  hashMessage: jest.fn((message) => '0xmockHashMessage'),
  id: jest.fn((text) => '0xmockId'),
  isValidName: jest.fn((name) => true),
  joinSignature: jest.fn((sig) => 'mockJoinedSignature'),
  splitSignature: jest.fn((sig) => ({ r: '0x', s: '0x', v: 0 })),
  verifyMessage: jest.fn((message, sig) => '0xmockSignerAddress'),
  verifyTypedData: jest.fn((domain, types, value, sig) => '0xmockSignerAddressFromTypedData'),
  computeAddress: jest.fn((key) => '0xmockComputedAddress'),
  recoverAddress: jest.fn((digest, sig) => '0xmockRecoveredAddress'),
  getContractAddress: jest.fn((tx) => '0xmockContractAddress'),
  randomBytes: jest.fn((length: number) => {
    const result = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      result[i] = i % 256; // Simple predictable bytes
    }
    return result;
  }),
};

// Add top-level export for ethers.getAddress, reusing the mock from utils
export const getAddress = utils.getAddress;

// --- BEGIN MODIFIED mockBigNumberInstanceMethods TYPE AND OBJECT ---
// Define a type where each method is a Jest mock returning the expected type
type MockBigNumberMethodImplementations = {
  [K in keyof MockBigNumber]: MockBigNumber[K] extends (...args: infer A) => infer R
    ? jest.Mock<R, A>
    : jest.Mock<MockBigNumber[K]>; // For properties that are not functions (should not happen here)
};

const mockBigNumberInstanceMethods: MockBigNumberMethodImplementations = {
  _isBigNumber: jest.fn(() => true) as any, // Property, not a method, handle differently or remove if not needed as mock fn
  _value: jest.fn(() => 0n) as any, // Property, not a method

  add: jest.fn(function (this: { _value: bigint }, other: any): MockBigNumber {
    return BigNumber.from(this._value + BigNumber.from(other)._value);
  }),
  sub: jest.fn(function (this: { _value: bigint }, other: any): MockBigNumber {
    return BigNumber.from(this._value - BigNumber.from(other)._value);
  }),
  mul: jest.fn(function (this: { _value: bigint }, other: any): MockBigNumber {
    return BigNumber.from(this._value * BigNumber.from(other)._value);
  }),
  div: jest.fn(function (this: { _value: bigint }, other: any): MockBigNumber {
    return BigNumber.from(this._value / BigNumber.from(other)._value);
  }),
  mod: jest.fn(function (this: { _value: bigint }, other: any): MockBigNumber {
    return BigNumber.from(this._value % BigNumber.from(other)._value);
  }),
  pow: jest.fn(function (this: { _value: bigint }, other: any): MockBigNumber {
    return BigNumber.from(this._value ** BigNumber.from(other)._value);
  }),
  abs: jest.fn(function (this: { _value: bigint }): MockBigNumber {
    return BigNumber.from(this._value < 0n ? -this._value : this._value);
  }),
  toString: jest.fn(function (this: { _value: bigint }): string {
    return this._value.toString();
  }),
  toNumber: jest.fn(function (this: { _value: bigint }): number {
    if (
      this._value > BigInt(Number.MAX_SAFE_INTEGER) ||
      this._value < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      throw new Error('overflow');
    }
    return Number(this._value);
  }),
  toHexString: jest.fn(function (this: { _value: bigint }): string {
    return '0x' + (this._value < 0n ? '-' : '') + this._value.toString(16).replace('-', '');
  }),
  eq: jest.fn(function (this: { _value: bigint }, other: any): boolean {
    return this._value === BigNumber.from(other)._value;
  }),
  lt: jest.fn(function (this: { _value: bigint }, other: any): boolean {
    return this._value < BigNumber.from(other)._value;
  }),
  lte: jest.fn(function (this: { _value: bigint }, other: any): boolean {
    return this._value <= BigNumber.from(other)._value;
  }),
  gt: jest.fn(function (this: { _value: bigint }, other: any): boolean {
    return this._value > BigNumber.from(other)._value;
  }),
  gte: jest.fn(function (this: { _value: bigint }, other: any): boolean {
    return this._value >= BigNumber.from(other)._value;
  }),
  isZero: jest.fn(function (this: { _value: bigint }): boolean {
    return this._value === 0n;
  }),
  isNegative: jest.fn(function (this: { _value: bigint }): boolean {
    return this._value < 0n;
  }),
  fromTwos: jest.fn(function (this: { _value: bigint }, bits: number): MockBigNumber {
    return BigNumber.from(this._value); /* simplified */
  }),
  toTwos: jest.fn(function (this: { _value: bigint }, bits: number): MockBigNumber {
    return BigNumber.from(this._value); /* simplified */
  }),
};
// --- END MODIFIED mockBigNumberInstanceMethods TYPE AND OBJECT ---

export const BigNumber: {
  from: (value: any) => MockBigNumber;
  isBigNumber: (value: any) => value is MockBigNumber;
} = {
  from: jest.fn((value: any): MockBigNumber => {
    let internalValue: bigint;
    if (value && value._isBigNumber && typeof value._value === 'bigint') {
      internalValue = value._value;
    } else if (typeof value === 'string') {
      if (value.startsWith('0x')) {
        internalValue = BigInt(value);
      } else if (value.startsWith('-0x')) {
        internalValue = -BigInt(value.substring(1)); // Remove '-' and parse the rest as hex
      } else {
        internalValue = BigInt(value); // For decimal strings (positive or negative)
      }
    } else if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) throw new Error('unsafe number for BigNumber.from');
      internalValue = BigInt(value);
    } else if (typeof value === 'bigint') {
      internalValue = value;
    } else {
      // Fallback for other types like Buffer, Uint8Array - very basic
      try {
        internalValue = BigInt(value.toString());
      } catch (e) {
        console.warn('BigNumber.from mock received unhandled type:', value, typeof value);
        internalValue = 0n; // Default to 0 if conversion fails
      }
    }
    return {
      _isBigNumber: true,
      _value: internalValue,
      // Ensure all methods from MockBigNumber are explicitly assigned here
      // using the jest.Mock instances from mockBigNumberInstanceMethods
      add: mockBigNumberInstanceMethods.add,
      sub: mockBigNumberInstanceMethods.sub,
      mul: mockBigNumberInstanceMethods.mul,
      div: mockBigNumberInstanceMethods.div,
      mod: mockBigNumberInstanceMethods.mod,
      pow: mockBigNumberInstanceMethods.pow,
      abs: mockBigNumberInstanceMethods.abs,
      toString: mockBigNumberInstanceMethods.toString,
      toNumber: mockBigNumberInstanceMethods.toNumber,
      toHexString: mockBigNumberInstanceMethods.toHexString,
      eq: mockBigNumberInstanceMethods.eq,
      lt: mockBigNumberInstanceMethods.lt,
      lte: mockBigNumberInstanceMethods.lte,
      gt: mockBigNumberInstanceMethods.gt,
      gte: mockBigNumberInstanceMethods.gte,
      isZero: mockBigNumberInstanceMethods.isZero,
      isNegative: mockBigNumberInstanceMethods.isNegative,
      fromTwos: mockBigNumberInstanceMethods.fromTwos,
      toTwos: mockBigNumberInstanceMethods.toTwos,
    };
  }),
  isBigNumber: jest.fn(
    (value: any): value is MockBigNumber =>
      typeof value === 'object' &&
      value !== null &&
      value._isBigNumber === true &&
      typeof value._value === 'bigint',
  ) as unknown as (value: any) => value is MockBigNumber, // Double cast to the type predicate signature
};

export const constants = {
  AddressZero: '0x0000000000000000000000000000000000000000',
  HashZero: '0x0000000000000000000000000000000000000000000000000000000000000000',
  Zero: BigNumber.from(0),
  One: BigNumber.from(1),
  Two: BigNumber.from(2),
  NegativeOne: BigNumber.from(-1),
  MaxInt256: BigNumber.from('0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
  MinInt256: BigNumber.from('-0x8000000000000000000000000000000000000000000000000000000000000000'),
  MaxUint256: BigNumber.from('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
  WeiPerEther: BigNumber.from('1000000000000000000'), // 10^18
  EtherSymbol: '\u039e',
};

export const version = 'mock-ethers-via-moduleNameMapper-v2';

export const ContractFactory = jest.fn().mockImplementation((abi, bytecode, signer) => ({
  interface: new utils.Interface(abi),
  bytecode,
  signer,
  deploy: jest.fn().mockResolvedValue({
    ...internalEthersContractMock('0xDeployedContractAddress', abi, signer),
    deployTransaction: {
      hash: '0xDeployTxHash',
      wait: jest
        .fn()
        .mockResolvedValue({ contractAddress: '0xDeployedContractAddress', status: 1 }),
    },
  }),
  getDeployTransaction: jest.fn().mockReturnValue({ data: '0xDeployBytecode' }),
  connect: jest.fn(function (this: any, newSigner) {
    this.signer = newSigner;
    return this;
  }),
  attach: jest.fn((address) => internalEthersContractMock(address, abi, signer)),
}));

export abstract class Signer {
  provider?: typeof providers.JsonRpcProvider | any; // Allow any for mock flexibility
  static isSigner(value: any): value is Signer {
    return !!(value && value._isSigner);
  }
  _isSigner: boolean = true;
  constructor() {
    // this.provider = provider;
  }
  abstract getAddress(): Promise<string>;
  abstract signMessage(message: string | Uint8Array): Promise<string>;
  abstract signTransaction(transaction: any): Promise<string>; // Deferrable<TransactionRequest>
  abstract connect(provider: typeof providers.JsonRpcProvider | any): Signer;

  // Common methods that might be called
  getFeeData = jest.fn().mockResolvedValue({ gasPrice: BigNumber.from('20000000000') });
  getBalance = jest.fn().mockResolvedValue(BigNumber.from('1000000000000000000')); // 1 ETH
  getTransactionCount = jest.fn().mockResolvedValue(0);
  estimateGas = jest.fn().mockResolvedValue(BigNumber.from('21000'));
  call = jest.fn().mockResolvedValue('0x');
  sendTransaction = jest
    .fn()
    .mockResolvedValue({ hash: '0xSentTxHash', wait: jest.fn().mockResolvedValue({ status: 1 }) });
  getChainId = jest.fn().mockResolvedValue(1); // Default to mainnet
  getGasPrice = jest.fn().mockResolvedValue(BigNumber.from('20000000000'));
  checkTransaction = jest.fn();
  populateTransaction = jest.fn().mockImplementation(async (tx: any) => ({
    ...tx,
    gasLimit: BigNumber.from('21000'),
    gasPrice: await this.getGasPrice(),
  }));
  resolveName = jest.fn((name: string) => Promise.resolve(name)); // Basic ENS passthrough
  _checkProvider = jest.fn();
}

export class VoidSigner extends Signer {
  address: string;
  constructor(address: string, provider?: any) {
    super();
    this.address = address;
    if (provider) this.provider = provider;
  }
  async getAddress(): Promise<string> {
    return this.address;
  }
  async signMessage(message: string | Uint8Array): Promise<string> {
    throw new Error('VoidSigner cannot sign');
  }
  async signTransaction(transaction: any): Promise<string> {
    throw new Error('VoidSigner cannot sign');
  }
  connect(provider: any): VoidSigner {
    this.provider = provider;
    return this;
  }
}

export const getDefaultProvider = providers.getDefaultProvider;

// Ensure other named exports that @wormhole-foundation/sdk or other deps might use are present
// Even if just as jest.fn()
export const logger = {
  _version: 'mock-logger-5.7.0',
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  makeError: jest.fn((message, code, params) =>
    Object.assign(new Error(message), { code, ...params }),
  ),
  Errors: {
    UNKNOWN_ERROR: 'UNKNOWN_ERROR',
    NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
    UNSUPPORTED_OPERATION: 'UNSUPPORTED_OPERATION',
    NETWORK_ERROR: 'NETWORK_ERROR',
    SERVER_ERROR: 'SERVER_ERROR',
    TIMEOUT: 'TIMEOUT',
    BUFFER_OVERRUN: 'BUFFER_OVERRUN',
    NUMERIC_FAULT: 'NUMERIC_FAULT',
    MISSING_ARGUMENT: 'MISSING_ARGUMENT',
    INVALID_ARGUMENT: 'INVALID_ARGUMENT',
    UNEXPECTED_ARGUMENT: 'UNEXPECTED_ARGUMENT',
    CALL_EXCEPTION: 'CALL_EXCEPTION',
    INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
    NONCE_EXPIRED: 'NONCE_EXPIRED',
    REPLACEMENT_UNDERPRICED: 'REPLACEMENT_UNDERPRICED',
    UNPREDICTABLE_GAS_LIMIT: 'UNPREDICTABLE_GAS_LIMIT',
    TRANSACTION_REPLACED: 'TRANSACTION_REPLACED',
    ACTION_REJECTED: 'ACTION_REJECTED',
  },
  setLogLevel: jest.fn(),
};

export const Wordlist = jest.fn(); // Placeholder for ethers.Wordlist if needed by BIP39 or mnemonics
export const HDNode = jest.fn(); // Placeholder for ethers.HDNode

// This new object uses the already defined (and individually exported)
// components from earlier in this file.
export const ethers = {
  Contract: Contract,
  Wallet: Wallet,
  providers: providers,
  utils: utils,
  BigNumber: BigNumber,
  constants: constants,
  version: version,
  ContractFactory: ContractFactory,
  Signer: Signer,
  VoidSigner: VoidSigner,
  getDefaultProvider: getDefaultProvider,
  getAddress: getAddress,
  logger: logger,
  Wordlist: Wordlist,
  HDNode: HDNode,
};
