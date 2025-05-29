// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

interface IBridgeTypes {
    struct BitcoinTxInfo {
        bytes version;
        bytes txInputVector;
        bytes txOutputVector;
        bytes locktime;
    }

    struct DepositRevealInfo {
        address depositor; // This is the L1 depositor contract address
        bytes4 depositHint; // Not directly used by AbstractL1BTCDepositor, but part of bridge interaction
        bytes blindingFactor;
        bytes walletPubKeyHash;
        bytes refundPubKeyHash;
        uint32 refundLocktime;
    }

    // Not directly used by AbstractL1BTCDepositor, but potentially part of full IBridge
    struct MovingAverageFee {
        uint64 fee;
        uint64 scale;
    }

    enum DepositState {
        // States relevant to AbstractL1BTCDepositor's _finalizeDeposit logic
        START,
        AWAITING_SIGNER_SETUP,
        AWAITING_BTC_FUNDING_PROOF,
        FAILED_SETUP,
        ACTIVE, // Deposit is active and tBTC can be claimed/minted
        AWAITING_WITHDRAWAL_SIGNATURE,
        AWAITING_WITHDRAWAL_PROOF,
        REDEEMED,
        COURTESY_CALL, // A state similar to ACTIVE for tBTC minting
        FRAUD_LIQUIDATION_IN_PROGRESS,
        LIQUIDATION_IN_PROGRESS,
        LIQUIDATED
    }
}

interface IBridge {
    function revealDepositWithExtraData(
        IBridgeTypes.BitcoinTxInfo calldata _fundingTx,
        IBridgeTypes.DepositRevealInfo calldata _reveal,
        bytes32 _extraData // This is the destinationChainDepositOwner for AbstractL1BTCDepositor
    ) external returns (uint256 depositKey, uint256 initialAmount);

    function getDepositDetails(uint256 _depositKey)
        external
        view
        returns (
            IBridgeTypes.DepositState state,
            uint256 amount, // Amount in Satoshis
            uint256 utxoSize, // Not directly used by AbstractL1BTCDepositor
            bytes32 extraData // The destinationChainDepositOwner
        );
    
    function depositParameters()
        external
        view
        returns (
            uint32 treasuryFeeDivisor,
            uint16 revealAheadPeriod,
            uint64 depositTxMaxFee, // Used by AbstractL1BTCDepositor for fee reimbursement/deduction logic
            uint64 auctionDuration
        );
} 