# System Patterns: tBTC Cross-Chain Relayer

## Core Architectural Patterns

### Chain Handler Pattern
The system uses a hierarchical Chain Handler architecture:
- `BaseChainHandler` abstract class provides common functionality for both L1 (Ethereum) and chain-specific logic
- Chain-specific implementations (`SuiChainHandler`, `EVMChainHandler`, etc.) extend BaseChainHandler
- Each handler is responsible for monitoring events and executing transactions on their respective chains

### Event-Driven Design
- The relayer operates as an event-driven system with two primary event flows:
  1. Sui -> Ethereum: `DepositInitialized` events trigger `initializeDeposit` calls on L1
  2. Ethereum -> Sui: `OptimisticMintingFinalized` events trigger `finalizeDeposit` calls on L1 which initiate Wormhole VAA process

### Wormhole Cross-Chain Communication
- Uses Wormhole VAA (Verified Action Approvals) pattern:
  1. Source chain (Ethereum) emits a VAA through `transferTokensWithPayload`
  2. Wormhole Guardians sign the VAA
  3. Wormhole Relayer delivers the VAA to the target chain (Sui)
  4. Target chain verifies and processes the VAA

### State Management
- Relayer maintains local deposit state with JSON storage
- Deposit progresses through states:
  - `QUEUED`: Initial state, waiting to be processed
  - `INITIALIZED`: Deposit revealed to L1 Bridge, waiting for minting
  - `FINALIZED`: Deposit complete, tBTC transferred to L2 (Sui)
- Reconciliation logic to match on-chain state with local state

## Implementation Patterns

### Nonce Management
- Uses `NonceManager` to handle transaction sequencing and prevent nonce conflicts
- Critical for reliable transaction submission in high-frequency environments

### Gas Fee Management
- Dynamic gas fee calculation for Ethereum transactions
- Wormhole message fee handling for cross-chain communication
- Uses `quoteFinalizeDeposit` to determine appropriate fees

### Error Handling & Retry Logic
- Time-based retry mechanism (`TIME_TO_RETRY` parameter) 
- Error status tracking 
- Different handling for temporary vs. permanent errors
- Special handling for "Deposit not finalized by the bridge" condition

### Modular Service Structure
- Separation of concerns between chain monitoring, deposit management, and transaction submission
- Chain-specific implementations for different blockchain integrations
- Reusable components for common functionality

## Design Principles

1. **Resilience**: Designed to handle temporary failures, network issues
2. **Reconciliation**: Periodic checking of on-chain state to correct local state
3. **Modularity**: Easily extendable to new chains through the handler pattern
4. **Separation of Concerns**: Clear boundaries between different functional areas 