# Active Implementation Context: tBTC Cross-Chain Relayer (using BTCDepositorWormhole)

## Current Focus
Implementing the cross-chain VAA message passing system between Ethereum and Sui using the `BTCDepositorWormhole` L1 contract and an event-driven relayer for VAA fetch/submit.

## Key Components (Revised)

### BitcoinDepositor (Sui)
- Contains `initialize_deposit` to start the process.
- Contains `receiveWormholeMessages` to receive VAAs submitted by the Relayer.
- Needs proper configuration of `trusted_emitter` (to L1 Token Bridge) to verify VAAs.

### BTCDepositorWormhole (Ethereum)
- **Adopted L1 Contract.**
- Handles `initializeDeposit` to reveal deposits to tBTC Bridge.
- Contains `finalizeDeposit` (payable only for base Wormhole message fee) called by Relayer.
- Internally calls `transferTokensWithPayload` on L1 Token Bridge.
- **Emits `TokensTransferredWithPayload` event containing the VAA sequence.**

### Wormhole Bridge
- Core messaging protocol (L1 Core for message fee, Sui Core for verification).
- **L1 Token Bridge** is the emitter of the VAA.
- **Sui Token Bridge** is used by the Gateway for redemption.

### Gateway (Sui)
- Handles redeeming tokens from Sui Wormhole Token Bridge (`complete_transfer_with_payload`).
- Responsible for parsing VAA payload (`abi.encodePacked(bytes32)`).
- Responsible for minting canonical L2 tBTC tokens.
- Needs implementation or verification of `redeem_tokens` function.

### Relayer (Off-Chain)
- Monitors Sui `DepositInitialized` events.
- Calls L1 `initializeDeposit`.
- Monitors L1 `OptimisticMintingFinalized` events.
- Calls L1 `finalizeDeposit` (paying base message fee).
- **Listens for L1 `TokensTransferredWithPayload` event.**
- **Extracts VAA sequence from the event.**
- **Polls Wormhole Guardian API to fetch signed VAA.**
- **Submits signed VAA to Sui `BitcoinDepositor::receiveWormholeMessages` (paying SUI gas).**

## Flow Stages (Revised)
1. User initiates on Sui (UI/SDK -> `SuiBD::initialize_deposit`).
2. Relayer detects Sui `DepositInitialized` event.
3. Relayer calls L1 `BTCDepositorWormhole::initializeDeposit`.
4. L1 contract reveals deposit to tBTC Bridge for minting.
5. Relayer monitors L1 `OptimisticMintingFinalized` event.
6. Relayer calls L1 `BTCDepositorWormhole::finalizeDeposit` (paying L1 msg fee).
7. L1 contract calls `transferTokensWithPayload` and emits `TokensTransferredWithPayload(sequence)`.
8. **Relayer detects `TokensTransferredWithPayload` event, gets sequence.**
9. **Relayer polls Guardian API using sequence, fetches signed VAA.**
10. **Relayer submits Sui Tx calling `BitcoinDepositor::receiveWormholeMessages(VAA)` (paying SUI gas).**
11. Sui BitcoinDepositor verifies VAA (Emitter=L1 Token Bridge) and forwards to Gateway.
12. Sui Gateway redeems tokens from Sui Token Bridge and mints canonical tBTC to user.

## Outstanding Questions (Revised)
1. Is the Sui `Gateway.redeem_tokens` function already implemented and does it correctly handle `abi.encodePacked(bytes32)` payload?
2. Has the `trusted_emitter` been configured correctly on deployed Sui `BitcoinDepositor` instances (pointing to L1 Token Bridge)?
3. What is the specific Wormhole Guardian API endpoint URL for fetching signed VAAs?
4. What are the expected gas costs for the relayer's Sui transaction (`receiveWormholeMessages`)?
5. What are the rate limits and reliability characteristics of the Guardian API? 