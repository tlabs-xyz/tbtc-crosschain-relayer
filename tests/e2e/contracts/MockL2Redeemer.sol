// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

contract MockL2Redeemer {
    // Event that the relayer's L2RedemptionService will listen for.
    // This event structure should be what WormholeVaaService expects
    // to parse for constructing the VAA request.
    // The `emitterAddress` for WH config will be this contract's address.
    event RedemptionRequested(
        address indexed l1Recipient,
        uint256 amountBtcMantissa,
        address l1TokenAddress, // e.g., address of mock tBTC on L1
        uint256 sequence,       // Wormhole sequence number (can be a simple counter)
        uint16 emitterChainId   // Wormhole chain ID of this L2 chain
        // Potentially other details if your VAA generation/parsing needs it
    );

    uint256 public currentSequence = 0;
    uint16 public immutable wormholeEmitterChainId; // Set in constructor

    constructor(uint16 _wormholeEmitterChainId) {
        wormholeEmitterChainId = _wormholeEmitterChainId;
    }

    // Function to initiate a redemption request
    // Called by the E2E test script
    function requestRedemption(
        address _l1Recipient,
        uint256 _amountBtcMantissa,
        address _l1TokenAddress
    ) external {
        currentSequence++;
        // In a real scenario, this might interact with a Wormhole core bridge contract
        // to publish a message. For the mock, we just emit the event directly
        // as if the message has been published.
        emit RedemptionRequested(
            _l1Recipient,
            _amountBtcMantissa,
            _l1TokenAddress,
            currentSequence,
            wormholeEmitterChainId
        );
    }
} 