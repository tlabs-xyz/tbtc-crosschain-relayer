# Technical Context: tBTC Cross-Chain Architecture (using BTCDepositorWormhole)

## System Architecture

### Chain Components
- **Bitcoin Network**: Source of BTC funds for deposit
- **Ethereum (L1)**: Where tBTC is officially minted
- **Sui (L2)**: Destination chain for user-facing tBTC

### Contract Components
- **BTCDepositorWormhole (Ethereum)**: Interfaces with tBTC Bridge, initiates Wormhole token transfers via `transferTokensWithPayload`, emits `TokensTransferredWithPayload` event containing the VAA sequence.
- **BitcoinDepositor (Sui)**: Handles deposit initialization and VAA reception from the relayer.
- **Gateway (Sui)**: Manages token redemption from Sui Token Bridge and minting of canonical L2 tBTC.
- **Wormhole Core (L1 & Sui)**: Cross-chain messaging protocol.
- **Wormhole Token Bridge (L1 & Sui)**: Token transfer extension for Wormhole.

### Off-Chain Components
- **Cross-Chain Relayer**: Monitors both chains, triggers L1 `finalizeDeposit`, listens for L1 `TokensTransferredWithPayload` event, fetches VAA from Guardian API, submits VAA to Sui.
- **Wormhole Guardians API**: Provides endpoint for fetching signed VAAs based on sequence number.

## Key Technical Interfaces

### BitcoinDepositor.initialize_deposit
```move
public entry fun initialize_deposit(
    funding_tx: vector<u8>,
    deposit_reveal: vector<u8>,
    deposit_owner: vector<u8>,
    ctx: &mut TxContext,
)
```

### BitcoinDepositor.receiveWormholeMessages
```move
public entry fun receiveWormholeMessages<CoinType>(
    receiver_state: &mut ReceiverState,
    gateway_state: &mut Gateway::GatewayState,
    capabilities: &mut Gateway::GatewayCapabilities,
    treasury: &mut Gateway::WrappedTokenTreasury<CoinType>,
    wormhole_state: &mut WormholeState,
    token_bridge_state: &mut token_bridge::state::State,
    token_state: &mut TBTC::TokenState,
    vaa_bytes: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

### BTCDepositorWormhole.initializeDeposit
```solidity
function initializeDeposit(
    IBridgeTypes.BitcoinTxInfo calldata fundingTx,
    IBridgeTypes.DepositRevealInfo calldata reveal,
    bytes32 destinationChainDepositOwner // L2 user address
) external
```

### BTCDepositorWormhole.finalizeDeposit
```solidity
function finalizeDeposit(uint256 depositKey) external payable
// Note: Payable amount covers only the base L1 Wormhole message fee.
```

### BTCDepositorWormhole._transferTbtc (Internal)
```solidity
function _transferTbtc(uint256 amount, bytes32 destinationChainReceiver) internal override
// Calls wormholeTokenBridge.transferTokensWithPayload
// Emits TokensTransferredWithPayload event
```

### BTCDepositorWormhole.TokensTransferredWithPayload (Event)
```solidity
event TokensTransferredWithPayload(
    uint256 amount, // Normalized amount (1e8)
    bytes32 destinationChainReceiver,
    uint64 transferSequence // VAA sequence number
);
```

## VAA Format and Processing (Revised)
VAAs consist of standard Wormhole structure.
Key steps:
1. `BTCDepositorWormhole` calls `transferTokensWithPayload` on L1 Token Bridge.
2. `BTCDepositorWormhole` emits `TokensTransferredWithPayload` event with the sequence number.
3. Relayer detects the event and extracts the sequence.
4. Relayer polls Wormhole Guardian API (`/v1/signed_vaa/{chain}/{emitter}/{sequence}`) using L1 Chain ID, L1 Token Bridge address, and sequence number.
5. Relayer receives signed VAA bytes (e.g., Base64 encoded).
6. Relayer submits a Sui transaction calling `BitcoinDepositor::receiveWormholeMessages` with the VAA bytes.
7. `BitcoinDepositor` verifies VAA (signatures via Sui Wormhole Core, emitter address/chain, replay protection) and forwards to `Gateway`.
8. `Gateway` calls Sui Token Bridge (`complete_transfer_with_payload`) to redeem wrapped tokens, parses payload (`abi.encodePacked(bytes32)`) for recipient, and mints canonical L2 tBTC.

## Configuration Requirements
- **BTCDepositorWormhole (L1)** needs correct addresses/values for:
  - `tbtcBridge`, `tbtcVault`
  - `wormhole` (Core L1 contract for message fee)
  - `wormholeTokenBridge`
  - `destinationChainWormholeGateway` (Sui Gateway address as bytes32)
  - `destinationChainId` (Sui Wormhole Chain ID)
- **BitcoinDepositor (Sui)** needs:
  - `trusted_emitter` set to the **L1 Wormhole Token Bridge address** (as ExternalAddress).
- **Relayer** needs:
  - L1 RPC, Private Key, BTCDepositorWormhole address
  - Sui RPC, Private Key (funded with SUI), BitcoinDepositor package ID/object IDs, Gateway object IDs, etc.
  - Wormhole Guardian API endpoint URL.

## Expected Gas Requirements (Revised)
- **L1 (`finalizeDeposit` Caller/Relayer):** Needs ETH for:
  - L1 transaction fee for `finalizeDeposit`.
  - `msg.value` covering the base `wormhole.messageFee()`.
- **Relayer (Sui):** Needs SUI for:
  - Gas fee for submitting the `receiveWormholeMessages` transaction on Sui. 