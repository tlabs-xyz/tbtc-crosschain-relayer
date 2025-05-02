# tBTC Cross-Chain Relayer for Sui Integration

## Project Overview
This project implements the cross-chain functionality required for minting tBTC tokens on the Sui blockchain. It focuses on the relay mechanism that processes deposit events from Sui to Ethereum (L1) and the subsequent finalization process that transfers minted tBTC from Ethereum back to Sui via Wormhole.

## Objectives
1. Implement a relayer service that listens to `DepositInitialized` events on Sui and calls `initializeDeposit` on the L1BitcoinDepositor contract
2. Monitor L1 for completed deposits and trigger the `finalizeDeposit` function on L1BitcoinDepositor
3. Implement the VAA message passing system that uses Wormhole to transfer tBTC tokens from Ethereum to Sui
4. Ensure proper verification and processing of VAAs on the Sui side through the BitcoinDepositor contract
5. Complete the Gateway contract on Sui that will redeem the tokens from Wormhole bridge

## Technical Context
- The system uses Wormhole as the cross-chain bridge for transferring tokens and messages
- The cross-chain flow starts with a Bitcoin deposit that is revealed on Sui, then processed on Ethereum for minting, and finally completed on Sui with the minted tokens
- The relayer service acts as an intermediary to monitor both chains and trigger the appropriate contract functions

## Timeline
TBD

## Stakeholders
- Threshold Network
- Sui Foundation
- tBTC Token holders 