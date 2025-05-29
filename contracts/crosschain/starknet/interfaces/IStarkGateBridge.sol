// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/**
 * @title IStarkGateBridge
 * @notice Interface for the StarkGate bridge contract for L1 interactions.
 * @dev This interface defines the functions relevant for the L1 depositor contract when bridging assets to StarkNet.
 * It includes functions for depositing tokens with a message and estimating message fees.
 */
interface IStarkGateBridge {
    /**
     * @notice Deposits tokens to StarkNet L2, optionally including a message for an L2 contract.
     * @param token The L1 address of the ERC20 token to be bridged.
     * @param amount The amount of tokens to bridge, in the L1 token's decimal precision.
     * @param l2Recipient The StarkNet address (represented as a felt, typically passed as uint256 from L1) of the recipient on L2.
     * @param message An array of felts (uint256 on L1) representing the calldata for a message to an L2 contract. Pass an empty array if no message.
     * @return messageNonce A unique identifier for this L1-to-L2 message, used for tracking.
     * @dev This function is typically payable. The `msg.value` sent should cover the L2 execution fee, which can be estimated using `estimateMessageFee`.
     * The bridge contract will forward the tokens and the message to the StarkNet L2 side.
     */
    function depositWithMessage(
        address token,
        uint256 amount,
        uint256 l2Recipient, // StarkNet addresses are felts, typically uint256 on L1
        uint256[] calldata message
    ) external payable returns (uint256 messageNonce);

    /**
     * @notice Estimates the L2 execution fee required for a message sent via `depositWithMessage`.
     * @return fee The estimated fee in ETH (wei).
     * @dev This fee should be provided as `msg.value` when calling `depositWithMessage`.
     * The actual fee can vary based on L2 network conditions.
     */
    function estimateMessageFee() external view returns (uint256 fee);

    // Placeholder for other functions if StarkNetBitcoinDepositor needs them from the bridge
    // For example, the TS interface had l1ToL2MessageFee() view returns (uint256)
    // If this is different from estimateMessageFee() and used, it should be here.
    // For now, sticking to T-007 original spec for estimateMessageFee.
    // The `tasks.md` for T-007 notes also used `address l2Recipient` for depositWithMessage.
    // I've used uint256 l2Recipient as it's more common for StarkNet addresses on L1 side.
    // This can be adjusted if the actual bridge interface uses `address`.
} 