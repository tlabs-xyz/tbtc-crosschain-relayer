# tBTC Cross-Chain Relayer Implementation Tasks

## Research and Analysis
- [x] Review Sui Flow documentation
- [x] Review Wormhole VAA relayer documentation
- [x] Analyze BitcoinDepositor.move contract
- [x] Analyze L1BitcoinDepositor.sol (Original Contract)
- [x] Analyze tbtc-v2 BTCDepositorWormhole.sol (Adopted L1 Contract)
- [x] Review existing Gateway implementation in Sui (`wormhole_gateway.move`)
    - [x] Confirmed `redeem_tokens` is implemented.
    - [x] Confirmed integration with `token_bridge::complete_transfer_with_payload`.
    - [x] Confirmed use of `helpers::parse_encoded_address` for payload (Assumed correct for `abi.encodePacked(bytes32)`).
- [x] Map out complete cross-chain flow with sequence diagrams (Revised)

## Relayer Implementation
- [x] Create SuiChainHandler to listen for DepositInitialized events
- [x] Implement parsing of Sui events into deposit object structures
- [x] Implement initializeDeposit call to L1 BTCDepositorWormhole
- [x] Set up monitoring for L1 tBTC Bridge/Vault for minting completion (OptimisticMintingFinalized event)
- [x] Implement finalizeDeposit call to L1 BTCDepositorWormhole (paying base Wormhole message fee)
- [x] Implement L1 listener for TokensTransferredWithPayload event (from BTCDepositorWormhole)
- [x] Implement VAA fetching logic (polling Guardian API using sequence from event)
- [x] Implement VAA submission logic (calling receiveWormholeMessages on Sui via SuiChainHandler)
- [x] Implement retry mechanisms for VAA processing with exponential backoff
- [x] Implement secure configuration handling with environment variables
- [ ] Ensure Relayer has SUI funding mechanism for VAA submission Txs

## Sui Contract Enhancements
- [ ] Verify `trusted_emitter` configuration in `BitcoinDepositor::ReceiverState` (must be L1 Token Bridge)
- [ ] Verify `trusted_emitter` configuration in `Gateway::GatewayState` (must be L1 Token Bridge)
- [ ] (Optional) Verify `l2_tbtc::helpers::parse_encoded_address` correctly decodes `abi.encodePacked(bytes32)`.
- [ ] Verify `Gateway.redeem_tokens` handles minting limit correctly.
- [ ] Verify `TBTC::mint` and `TBTC::burn` calls within Gateway are correct.

## Deployment and Configuration
- [x] Create Docker configuration for containerized deployment
- [x] Implement environment variables configuration for secure secrets management
- [x] Update package.json with appropriate scripts for running the relayer
- [ ] Configure trusted emitter addresses (in *both* BitcoinDepositor and Gateway)
- [ ] Configure Relayer (L1/Sui RPCs, contract addresses, API endpoint, SUI wallet)
- [ ] Verify end-to-end flow on testnet
- [ ] Prepare mainnet deployment plan

## Integration Testing
- [ ] Set up local testing environment with Wormhole validators
- [ ] Create test suite for full cross-chain deposit process (using BTCDepositorWormhole)
- [ ] Test VAA generation, fetch, and verification
- [ ] Test token transfer and redemption (including minting limit edge case)
- [ ] Test error handling and edge cases (API errors, Sui Tx failures, duplicate VAAs)

## Documentation
- [x] Document sequence flow for Ethereum to Sui VAA relay
- [x] Document configuration parameters (environment variables and JSON)
- [x] Create comprehensive README with deployment and operation instructions
- [x] Document container deployment options
- [ ] Create troubleshooting guide for common issues
- [ ] Document maintenance procedures and monitoring recommendations 