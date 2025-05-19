// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

contract MockL1Redeemer {
    // Event to signify that the redemption was completed on L1
    // The E2E test script will poll for this event.
    event RedemptionCompleted(
        address indexed recipient,
        uint256 amount,
        bytes32 vaaHash // Or some unique identifier from the VAA
    );

    // This is the function your L1RedemptionHandler will call.
    // It mimics `finalizeL2Redemption` or similar.
    // The `vaa` parameter might be the full VAA bytes, or just the payload
    // depending on what your L1RedemptionHandler is designed to pass.
    // The E2E script expects to find an event by recipient and amount.
    function completeRedemption(
        address _recipient,
        uint256 _amount,
        bytes calldata _vaa // For simplicity, we might just use a hash or sequence from it
    // A real contract would parse the VAA here.
    ) external {
        // Mock VAA "verification" - in a real contract, this would involve
        // calling the Wormhole core bridge to verify the VAA signatures.
        // For the mock, we can assume it's valid if this function is called.

        // Simulate completing the redemption.
        // This could involve transferring tokens, but for a mock,
        // emitting the event is often sufficient for E2E testing.
        bytes32 vaaHash = keccak256(_vaa); // Example of getting a unique ID from VAA
        emit RedemptionCompleted(_recipient, _amount, vaaHash);
    }
} 
