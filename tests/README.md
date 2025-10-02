# tBTC Cross-Chain Relayer Testing Framework

This directory contains a comprehensive testing framework for the tBTC Cross-Chain Relayer. The tests are organized into three main categories:

1. **Unit Tests**: Testing individual functions and components in isolation
2. **Integration Tests**: Testing interactions between components
3. **End-to-End Tests**: Testing complete workflows and API endpoints

## Directory Structure

```
tests/
├── data/                 # Test data directory
├── logs/                 # Test logs directory
├── docker-compose.test.yml  # PostgreSQL test database setup
├── jest.config.cjs       # Jest configuration
├── jest.global-setup.js  # Database initialization
├── jest.global-teardown.js # Database cleanup
├── package.json          # Test scripts and dependencies
├── setup.ts              # Test setup file
├── e2e/                  # End-to-end tests
├── integration/          # Integration tests
├── mocks/                # Mock implementations
│   ├── BlockchainMock.ts # Mock blockchain providers and contracts
│   ├── MockChainHandler.ts # Mock chain handler
│   ├── SuiMock.ts        # Mock Sui blockchain
│   ├── ethers.mock.js    # Mock ethers.js library
│   ├── fetch.mock.js     # Mock fetch API
│   ├── Logger.mock.js    # Mock logger
│   └── Deposit.mock.js   # Mock deposit data
└── unit/                 # Unit tests
    ├── config/           # Tests for configuration
    ├── handlers/         # Tests for chain handlers
    ├── services/         # Tests for services (ExecutorService, L1DepositorService)
    └── utils/            # Tests for utility functions
```

## Running Tests

### Prerequisites

- Node.js 22 LTS (use `nvm use` to automatically switch versions)
- Docker (for PostgreSQL test database)
- npm or yarn

### Installation

Install dependencies:

```bash
npm install
```

### Running Tests

You can run tests using these commands:

```bash
# Run all tests (requires test database)
npm test

# Run service tests only
DATABASE_URL="postgresql://postgres:password@localhost:5433/tbtc_relayer_test" npx jest tests/unit/services/

# Run specific test categories
npm run test:unit
npm run test:integration
npm run test:e2e

# Run with coverage report
npm run test:coverage
```

### Test Database Setup

Tests use a PostgreSQL database in Docker (port 5433 to avoid conflicts):

```bash
# Start test database
docker-compose -f tests/docker-compose.test.yml up -d postgres-test

# Stop test database
docker-compose -f tests/docker-compose.test.yml down -v

# Or use test scripts
cd tests
npm run db:setup      # Start database
npm run db:teardown   # Stop database
npm run db:reset      # Reset database
```

**Database Connection**: `postgresql://postgres:password@localhost:5433/tbtc_relayer_test`

## Test Categories

### Unit Tests

Unit tests focus on testing individual functions and modules in isolation. They use mocks to simulate dependencies and are designed to be fast and reliable.

Example:

```typescript
// Testing ExecutorService
describe('ExecutorService', () => {
  test('should generate executor parameters successfully', async () => {
    const result = await executorService.generateExecutorParameters(
      2, // Ethereum source chain
      40, // SeiEVM destination chain
      '0x1234567890123456789012345678901234567890',
      '0x01'
    );
    
    expect(result).toHaveProperty('executorArgs');
    expect(result).toHaveProperty('estimatedCost');
  });
});
```

### Integration Tests

Integration tests verify that different components of the system work correctly together. They test interactions between modules, such as controllers and services.

Example:

```typescript
// Testing EndpointController with MockChainHandler
describe('EndpointController', () => {
  test('should handle reveal requests', async () => {
    // Test implementation
  });
});
```

### End-to-End Tests

End-to-end tests verify complete workflows from a user's perspective. They test API endpoints and simulate user interactions with the system.

Example:

```typescript
// Testing API endpoints
describe('API Endpoints', () => {
  test('should process a complete deposit lifecycle', async () => {
    // Test implementation
  });
});
```

## Mocks

The testing framework includes several mock implementations:

- **MockChainHandler**: Implements the ChainHandlerInterface for testing
- **BlockchainMock**: Provides mock implementations of blockchain providers and contracts
- **SuiMock**: Simulates Sui blockchain interactions
- **ethers.mock.js**: Complete ethers.js v5 mocking (utils, BigNumber, constants, providers, Wallet, Contract)
- **fetch.mock.js**: Global fetch API with Wormhole Executor API defaults
- **Logger.mock.js**: Mock logger to suppress console output during tests
- **Deposit.mock.js**: Mock deposit data structures with factory function
- **MockProvider**: Simulates an Ethereum provider
- **MockContract**: Simulates a contract instance

These mocks can be used to simulate various scenarios, including error conditions and edge cases. All mocks are automatically loaded via `setup.ts`.

## Test Data

Test data is stored in the `tests/data/` directory. This directory is created automatically when running tests and is cleaned up after tests complete.

## Test Logs

Test logs are stored in the `tests/logs/` directory. This directory is created automatically when running tests and is cleaned up after tests complete.

## Best Practices

When writing tests:

1. **Isolate Tests**: Each test should be independent and not rely on state from other tests
2. **Use Descriptive Names**: Test names should clearly describe what is being tested
3. **Follow AAA Pattern**: Arrange, Act, Assert
4. **Clean Up**: Clean up resources after tests complete
5. **Test Edge Cases**: Include tests for error conditions and edge cases
6. **Keep Tests Fast**: Tests should run quickly to provide fast feedback
7. **Use Mocks Appropriately**: Use mocks to isolate components and simulate dependencies

## Writing New Tests

To write a new test:

```typescript
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

describe('MyService', () => {
  let service: MyService;

  beforeEach(() => {
    service = new MyService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should do something', () => {
    // Arrange
    const input = 'test';
    
    // Act
    const result = service.doSomething(input);
    
    // Assert
    expect(result).toBe('expected');
  });
});
```

Mocks are pre-configured in `setup.ts` - no manual setup needed. See existing tests in `unit/services/` for examples of mocking complex dependencies like ethers.js.
