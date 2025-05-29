// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "../crosschain/starknet/interfaces/IStarkGateBridge.sol";

// Interface for the attacker contract callback
interface IReentrancyAttackerCallback {
    function triggerReentrancyCall() external payable;
}

contract MockStarkGateBridge is IStarkGateBridge {
    uint256 private mockMessageNonce;
    bool private depositWithMessageCalled;
    address private lastToken;
    uint256 private lastAmount;
    uint256 private lastL2Recipient;
    bytes private lastMessage;
    uint256 private lastValueSent;

    uint256 private mockEstimatedFee = 0.01 ether; // Default

    // State for revert control
    bool private shouldRevertNextCall;
    string private revertMessageText; // State variable

    // State for re-entrancy test control
    address private reentrancyAttackerAddress;
    bool private callAttackerOnNextDeposit;

    event DepositWithMessageCalled(
        address token,
        uint256 amount,
        uint256 l2Recipient,
        bytes message,
        uint256 value
    );

    function depositWithMessage(
        address token,
        uint256 amount,
        uint256 l2Recipient,
        bytes calldata message
    ) external payable override returns (uint256 messageNonce) {
        if (shouldRevertNextCall) {
            shouldRevertNextCall = false; // Reset for subsequent calls
            revert(revertMessageText);
        }

        if (callAttackerOnNextDeposit && reentrancyAttackerAddress != address(0)) {
            callAttackerOnNextDeposit = false; // Reset for subsequent calls
            IReentrancyAttackerCallback(reentrancyAttackerAddress).triggerReentrancyCall{value: msg.value}();
        }

        depositWithMessageCalled = true;
        lastToken = token;
        lastAmount = amount;
        lastL2Recipient = l2Recipient;
        lastMessage = message;
        lastValueSent = msg.value;
        emit DepositWithMessageCalled(token, amount, l2Recipient, message, msg.value);
        return mockMessageNonce;
    }

    function estimateMessageFee() external view override returns (uint256 fee) {
        return mockEstimatedFee;
    }

    // --- Mock control functions ---
    function setDepositWithMessageResponse(uint256 nonce) external {
        mockMessageNonce = nonce;
    }

    function setEstimateMessageFeeResponse(uint256 fee) external {
        mockEstimatedFee = fee;
    }

    function setNextDepositWithMessageRevert(bool _shouldRevert, string calldata _message) external {
        shouldRevertNextCall = _shouldRevert;
        revertMessageText = _message;
    }

    function setReentrancyAttackParameters(address _attackerAddress, bool _callAttacker) external {
        reentrancyAttackerAddress = _attackerAddress;
        callAttackerOnNextDeposit = _callAttacker;
    }

    // --- Getter functions for test assertions ---
    function getDepositWithMessageCalled() external view returns (bool) {
        return depositWithMessageCalled;
    }

    function getLastDepositDetails()
        external
        view
        returns (
            address token,
            uint256 amount,
            uint256 l2Recipient,
            bytes memory message,
            uint256 valueSent
        )
    {
        return (lastToken, lastAmount, lastL2Recipient, lastMessage, lastValueSent);
    }
} 