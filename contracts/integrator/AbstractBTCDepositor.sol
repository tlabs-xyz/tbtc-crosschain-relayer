// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./IBridge.sol";
import "./ITBTCVault.sol";

/**
 * @title AbstractBTCDepositor (Mock)
 * @notice Mocked version of AbstractBTCDepositor for StarkNetBitcoinDepositor development.
 * @dev This only contains elements directly used or overridden by AbstractL1BTCDepositor.
 */
abstract contract AbstractBTCDepositor {
    IBridge public bridge;
    ITBTCVault public tbtcVault;

    uint256 internal constant SATOSHI_MULTIPLIER = 10**10; // 1 BTC = 10^8 Satoshis, 1 tBTC = 10^18 wei. Scale factor for amounts.

    // Event from original AbstractBTCDepositor, if needed by AbstractL1BTCDepositor logic or tests.
    // event DepositRevealed(uint256 indexed depositKey, address depositor, uint256 amount, bytes32 extraData);

    function __AbstractBTCDepositor_initialize(
        address _tbtcBridge,
        address _tbtcVault
    ) internal virtual {
        bridge = IBridge(_tbtcBridge);
        tbtcVault = ITBTCVault(_tbtcVault);
    }

    function _initializeDeposit(
        IBridgeTypes.BitcoinTxInfo calldata fundingTx,
        IBridgeTypes.DepositRevealInfo calldata reveal,
        bytes32 destinationChainDepositOwner
    ) internal virtual returns (uint256 depositKey, uint256 initialAmount) {
        // This calls the actual tBTC bridge to reveal the deposit.
        // In a mock, we might not do much, or just return dummy values.
        // For the purpose of StarkNetBitcoinDepositor, AbstractL1BTCDepositor calls this.
        return bridge.revealDepositWithExtraData(fundingTx, reveal, destinationChainDepositOwner);
    }

    function _finalizeDeposit(uint256 depositKey)
        internal
        virtual
        returns (
            uint256 initialAmount, // in Satoshis
            uint256 tbtcAmount,    // in Wei (1e18)
            bytes32 destinationChainDepositOwner
        )
    {
        // This retrieves details from the tBTC bridge after tBTC is minted.
        // AbstractL1BTCDepositor calls this.
        (IBridgeTypes.DepositState state, uint256 satoshiAmount, , bytes32 extraData) = bridge.getDepositDetails(depositKey);

        // Simplified state check based on what AbstractL1BTCDepositor might expect
        // The original contract checks for ACTIVE or COURTESY_CALL
        require(state == IBridgeTypes.DepositState.ACTIVE || state == IBridgeTypes.DepositState.COURTESY_CALL, "Deposit not active");

        initialAmount = satoshiAmount;
        // Convert satoshiAmount (1e8) to tbtcAmount (1e18)
        tbtcAmount = satoshiAmount * SATOSHI_MULTIPLIER; // 10^8 * 10^10 = 10^18
        destinationChainDepositOwner = extraData;

        return (initialAmount, tbtcAmount, destinationChainDepositOwner);
    }

    // Placeholder for other functions/state variables if they become necessary
} 