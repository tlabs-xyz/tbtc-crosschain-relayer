// Mock ethers.js for tests
const mockEthers = {
  utils: {
    isAddress: jest.fn((address) => /^0x[a-fA-F0-9]{40}$/.test(String(address))),
    hexZeroPad: jest.fn((value, length) => {
      const hex = String(value).toString(16).replace('0x', '');
      return '0x' + hex.padStart(length * 2, '0');
    }),
    hexlify: jest.fn((value) => '0x' + String(value).toString(16)),
    formatEther: jest.fn((value) => {
      const num = parseInt(String(value)) / 1e18;
      return num.toFixed(18);
    }),
    keccak256: jest.fn((data) => '0x' + 'a'.repeat(64)),
    toUtf8Bytes: jest.fn((str) => '0x' + Buffer.from(String(str)).toString('hex')),
  },
  BigNumber: {
    from: jest.fn((value) => ({
      toString: () => String(value),
      add: jest.fn((other) => ({ 
        toString: () => (parseInt(String(value)) + parseInt(String(other).toString())).toString() 
      })),
      lt: jest.fn((other) => parseInt(String(value)) < parseInt(String(other).toString())),
      isBigNumber: jest.fn(() => true),
    })),
    isBigNumber: jest.fn(() => true),
  },
  constants: {
    AddressZero: '0x0000000000000000000000000000000000000000',
  },
  providers: {
    JsonRpcProvider: jest.fn().mockImplementation(() => ({
      getBalance: jest.fn().mockResolvedValue('2000000000000000000'),
      getTransactionCount: jest.fn().mockResolvedValue(42),
    })),
  },
  Wallet: jest.fn().mockImplementation(() => ({
    getBalance: jest.fn().mockResolvedValue('2000000000000000000'),
    getTransactionCount: jest.fn().mockResolvedValue(42),
  })),
  Contract: jest.fn().mockImplementation(() => ({
    initializeDeposit: jest.fn(),
    setExecutorParameters: jest.fn(),
    finalizeDeposit: jest.fn(),
    quoteFinalizeDeposit: jest.fn(),
    areExecutorParametersSet: jest.fn(),
    getStoredExecutorValue: jest.fn(),
    clearExecutorParameters: jest.fn(),
    encodeDestinationReceiver: jest.fn(),
  })),
};

module.exports = mockEthers;
