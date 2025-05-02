# tBTC Cross-Chain Relayer Implementation Tasks

## Research and Analysis
- [x] Review Sui Flow documentation
- [x] Review Wormhole VAA relayer documentation
- [x] Analyze BitcoinDepositor.move contract
- [x] Analyze L1BitcoinDepositor.sol (Original Contract)
- [x] Analyze tbtc-v2 BTCDepositorWormhole.sol (Adopted L1 Contract)
- [ ] Review existing Gateway implementation in Sui
- [x] Map out complete cross-chain flow with sequence diagrams (Revised)

## Relayer Implementation
- [ ] Create SuiChainHandler to listen for DepositInitialized events
- [ ] Implement parsing of Sui events into deposit object structures
- [ ] Implement initializeDeposit call to L1 BTCDepositorWormhole
- [ ] Set up monitoring for L1 tBTC Bridge/Vault for minting completion (OptimisticMintingFinalized event)
- [ ] Implement finalizeDeposit call to L1 BTCDepositorWormhole (paying base Wormhole message fee)
- [ ] Implement L1 listener for TokensTransferredWithPayload event (from BTCDepositorWormhole)
- [ ] Implement VAA fetching logic (polling Guardian API using sequence from event)
- [ ] Implement VAA submission logic (calling receiveWormholeMessages on Sui via SuiChainHandler)
- [ ] Ensure Relayer has SUI funding mechanism for VAA submission Txs

## Sui Contract Enhancements
- [ ] Verify trusted_emitter configuration in ReceiverState (must be L1 Token Bridge)
- [ ] Implement or verify Gateway.redeem_tokens function
- [ ] Ensure proper integration with Sui Wormhole Token Bridge (complete_transfer_with_payload)
- [ ] Implement payload parsing (abi.encodePacked(bytes32)) to extract l2DepositOwner address
- [ ] Implement the minting of canonical L2 tBTC and transfer to user

## Integration Testing
- [ ] Set up local testing environment with Wormhole validators
- [ ] Create test suite for full cross-chain deposit process (using BTCDepositorWormhole)
- [ ] Test VAA generation, fetch, and verification
- [ ] Test token transfer and redemption
- [ ] Test error handling and edge cases (API errors, Sui Tx failures)

## Deployment and Configuration
- [ ] Deploy updated contracts (BTCDepositorWormhole on L1, potentially Gateway on Sui) to testnet
- [ ] Configure trusted emitter addresses
- [ ] Configure Relayer (L1/Sui RPCs, contract addresses, API endpoint, SUI wallet)
- [ ] Verify end-to-end flow on testnet
- [ ] Prepare mainnet deployment plan

## Documentation
- [ ] Create detailed technical documentation of the implementation
- [ ] Document the contract interactions and sequence flow (Updated)
- [ ] Create troubleshooting guide for common issues
- [ ] Document configuration parameters and their effects 