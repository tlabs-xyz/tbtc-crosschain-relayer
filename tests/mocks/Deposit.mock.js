// Mock Deposit type for tests
const mockDeposit = {
  id: 'test-deposit-123',
  fundingTxHash: '0x' + 'b'.repeat(64),
  fundingOutputIndex: 0,
  amount: '1000000000000000000', // 1 tBTC in wei
  destinationChainId: 40, // SeiEVM
  recipientAddress: '0x' + 'c'.repeat(40),
  status: 'PENDING',
  wormholeInfo: {
    txHash: null,
    transferSequence: null,
    bridgingAttempted: false,
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

module.exports = {
  mockDeposit,
  createMockDeposit: (overrides = {}) => ({
    ...mockDeposit,
    ...overrides,
  }),
};
