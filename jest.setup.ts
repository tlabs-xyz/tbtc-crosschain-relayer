// Mock environment variables for testing
process.env.PRIVATE_KEY =
  '0x0000000000000000000000000000000000000000000000000000000000000001'; // Test private key
process.env.L1_RPC = 'http://localhost:8545';
process.env.L2_RPC = 'http://localhost:8546';
process.env.L1BitcoinDepositor = '0x0000000000000000000000000000000000000001';
process.env.L2BitcoinDepositor = '0x0000000000000000000000000000000000000002';
process.env.TBTCVault = '0x0000000000000000000000000000000000000003';

jest.setTimeout(30000); // Default timeout for all tests

// Global mock for process.exit to prevent tests from stopping the runner
// and allow assertions on exit codes.
const mockProcessExit = jest
  .spyOn(process, 'exit')
  .mockImplementation((code?: string | number | null | undefined): never => {
    throw new Error(
      'process.exit called with code ' +
        (code === null || code === undefined ? 'undefined' : code.toString())
    );
  });

beforeEach(() => {
  mockProcessExit.mockClear();
});
