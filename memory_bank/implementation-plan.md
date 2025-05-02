# tBTC Cross-Chain Relayer Implementation Plan

## Implementation Requirements

### 1. SuiChainHandler Extensions

- [x] Add `@mysten/sui` dependency for Sui blockchain interaction
- [x] Implement Sui client initialization in `initializeL2()` method
- [x] Configure event subscription for DepositInitialized events
- [x] Implement VAA submission function (`submitVaaToSui`) with retry mechanism
- [x] Add support for fetching and processing past events

### 2. VAA Relayer Component

- [x] Create `ETHVAASuiRelayer` class
- [x] Implement listener for TokensTransferredWithPayload events on Ethereum
- [x] Add Guardian API integration for VAA retrieval
- [x] Implement retry logic with exponential backoff for VAA submission
- [x] Add tracking mechanism to avoid duplicate processing

### 3. Configuration and Setup

- [x] Create configuration structure with Ethereum, Sui, and Wormhole parameters
- [x] Add support for object IDs required for Sui transaction submission
- [x] Create entry point script (`vaa-relayer.ts`) for standalone VAA relayer operation
- [x] Document configuration requirements
- [x] Implement environment variables support for secure configuration

### 4. Transaction Handling

- [x] Implement proper transaction building for Sui Move calls
- [x] Add error handling and logging
- [x] Implement idempotent transaction processing

### 5. Documentation

- [x] Create sequence diagrams for cross-chain flow
- [x] Document core system components
- [x] Provide configuration examples
- [x] Create comprehensive README

## Testing Strategy

- [ ] Unit tests for SuiChainHandler functionality
- [ ] Unit tests for ETHVAASuiRelayer functionality
- [ ] Integration tests with mock Guardian API
- [ ] End-to-end tests with testnet deployments

## Deployment Strategy

- [x] Create Docker configuration for containerized deployment
- [x] Add environment variable support
- [ ] Document deployment procedures
- [ ] Implement health check endpoints

## Monitoring and Maintenance

- [ ] Add structured logging
- [ ] Implement basic metrics collection
- [ ] Create alerting mechanisms for failed VAA submissions
- [ ] Document monitoring and maintenance procedures
