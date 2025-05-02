# tBTC Cross-Chain Relayer Implementation Progress

## Current Status
Planning phase complete. Analysis of L1 contract options finished. Implementation plan updated to use `BTCDepositorWormhole` and event-driven VAA relay.

## Completed
- Reviewed all relevant documentation (Sui Flow docs, Wormhole VAA relayer docs)
- Analyzed existing contracts (BitcoinDepositor.move)
- Analyzed L1 contract options (`L1BitcoinDepositorWormhole.sol`, `BTCDepositorWormhole.sol`)
- **Selected `BTCDepositorWormhole.sol` as the L1 contract.**
- Created detailed summary and sequence diagrams for VAA message passing (Revised for event-driven relayer VAA fetch/submit)
- Identified key configuration points and implementation needs (Updated for new L1 contract and flow)
- Updated Memory Bank files (`sequenceDiagram.md`, `techContext.md`, `tasks.md`, `activeContext.md`, `progress.md`)

## In Progress
- Reviewing Sui Gateway contract implementation (`Gateway.redeem_tokens` function and payload parsing)
- Preparing detailed implementation plan for SuiChainHandler (including VAA submission logic)

## Next Steps
- Check existing `Gateway.redeem_tokens` function implementation and payload handling.
- Verify configuration points in deployed contracts (especially `trusted_emitter` on Sui).
- **Start implementing `SuiChainHandler` components:**
    - Event listener for `DepositInitialized`.
    - VAA submission logic (`receiveWormholeMessages` call).
- **Start implementing Relayer L1 components:**
    - Listener for `TokensTransferredWithPayload`.
    - VAA fetching logic (Guardian API polling).
- Set up local testing environment.

## Blockers
- Need to verify current Gateway implementation status and payload parsing.
- Need confirmation on `trusted_emitter` configuration approach/status on Sui.
- Need Wormhole Guardian API endpoint details.

## Timeline Updates
- Planning phase: Complete
- Implementation phase: Ready to Start
- Testing phase: Not started
- Deployment phase: Not started 