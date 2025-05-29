// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "../crosschain/starknet/StarkNetBitcoinDepositor.sol";

interface IAttackerTarget {
    function finalizeDeposit(uint256 depositKey) external payable;
    // Function to receive ETH if finalizeDeposit sends it back (not the case here, but good practice for generic attackers)
    // function owner() external view returns (address); // To allow attacker to call setDepositStateForTesting
}

contract ReentrancyAttacker {
    IAttackerTarget public immutable target; // StarkNetBitcoinDepositor
    address public starkGateBridgeMock; // To be called by this mock

    uint256 public attackDepositKey;
    uint256 public feeForAttack;
    bool public reenterToggle = true; // Control re-entrancy to avoid infinite loops in tests

    // Placeholder for StarkNetBitcoinDepositor owner to setup the test
    // address public snDepositorOwner;

    constructor(address _target) {
        target = IAttackerTarget(_target);
        // snDepositorOwner = IAttackerTarget(_target).owner();
    }

    function setAttackParameters(uint256 _depositKey, uint256 _fee, address _starkGateMock) external {
        attackDepositKey = _depositKey;
        feeForAttack = _fee;
        starkGateBridgeMock = _starkGateMock;
    }

    // This function is called by the user/test to start the attack
    function attemptAttack() external payable {
        require(msg.value == feeForAttack, "Incorrect ETH for attack");
        // The attacker itself doesn't call finalizeDeposit directly in this setup.
        // Instead, the test will call finalizeDeposit on the target,
        // and the MockStarkGateBridge, when called by the target, will call triggerReentrancyCall on this attacker.
        // So this function might not be needed if the test orchestrates it.
        // However, if the attacker is the one initiating the first finalizeDeposit:
        target.finalizeDeposit{value: msg.value}(attackDepositKey);
    }

    // This function will be called by MockStarkGateBridge
    function triggerReentrancyCall() external payable {
        if (reenterToggle) {
            reenterToggle = false; // Prevent infinite loop
            // Attempt to re-enter finalizeDeposit on the original target contract
            // It needs to send the required fee again if the re-entrant call is to succeed past the fee check,
            // though it should be stopped by nonReentrant guard before that.
            target.finalizeDeposit{value: feeForAttack}(attackDepositKey);
        }
    }

    // This function will be called by the target contract during its execution,
    // if the target contract sends ETH to this contract.
    // StarkNetBitcoinDepositor.finalizeDeposit -> _transferTbtc -> starkGateBridge.depositWithMessage
    // It does not send ETH back to msg.sender or this contract directly.
    // Re-entrancy would typically occur if the target called a function on msg.sender
    // or transferred ETH (triggering receive() or fallback()) before fully updating state.

    // To test re-entrancy on finalizeDeposit, the mock StarkGateBridge would need to call back
    // into this attacker contract during depositWithMessage.

    // For a simpler re-entrancy test on a function that *could* be re-entered if it made an external call
    // *before* state changes and that external call could call back:
    // Let's assume we have a function in StarkNetBitcoinDepositor:
    // function potentiallyReentrantFunction(address attacker) external {
    //     // calls attacker before state change
    //     IAttacker(attacker).callback();
    //     // stateChange();
    // }
    // Then the attacker would have:
    // function callback() external {
    //     if (reenterToggle) {
    //         reenterToggle = false; // Prevent infinite loop
    //         StarkNetBitcoinDepositor(msg.sender).potentiallyReentrantFunction(address(this));
    //     }
    // }

    // Since finalizeDeposit's main external call is to StarkGate, which is a mock,
    // we'd need MockStarkGateBridge to be the one that calls back to this attacker.

    fallback() external payable {
        // In case MockStarkGateBridge sends ETH back, not expected for this test
    }

    receive() external payable {
        // In case MockStarkGateBridge sends ETH back, not expected for this test
    }
} 