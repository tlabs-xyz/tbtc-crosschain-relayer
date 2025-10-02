// Mock fetch for tests
global.fetch = jest.fn();

// Default mock response
const mockFetchResponse = {
  ok: true,
  status: 200,
  statusText: 'OK',
  json: jest.fn().mockResolvedValue({
    signedQuote: '0x' + 'a'.repeat(200), // Mock signed quote
    estimatedCost: '1000000000000000000', // 1 ETH in wei
  }),
};

// Set default mock
global.fetch.mockResolvedValue(mockFetchResponse);

module.exports = {
  mockFetchResponse,
  resetFetchMock: () => {
    global.fetch.mockClear();
    global.fetch.mockResolvedValue(mockFetchResponse);
  },
};
