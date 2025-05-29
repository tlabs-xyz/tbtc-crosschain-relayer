// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "../integrator/IBridge.sol";

contract MockBridge is IBridge {
    uint256 public nextDepositKey = 1;
    uint256 public defaultInitialAmount = 100000000; // 1 BTC in Satoshis

    struct DepositDetails {
        IBridgeTypes.DepositState state;
        uint256 amount;
        uint256 utxoSize;
        bytes32 extraData;
    }
    mapping(uint256 => DepositDetails) public depositDetailsStore;

    struct DepositParams {
        uint32 treasuryFeeDivisor;
        uint16 revealAheadPeriod;
        uint64 depositTxMaxFee;
        uint64 auctionDuration;
    }
    DepositParams public currentDepositParams;

    // --- Storages for returning values from mocked functions ---
    uint256 private mockRevealDepositKey;
    uint256 private mockRevealInitialAmount;

    IBridgeTypes.DepositState private mockGetDepositState;
    uint256 private mockGetDepositAmount;
    uint256 private mockGetDepositUtxoSize;
    bytes32 private mockGetDepositExtraData;

    uint32 private mockParamsTreasuryFeeDivisor;
    uint16 private mockParamsRevealAheadPeriod;
    uint64 private mockParamsDepositTxMaxFee;
    uint64 private mockParamsAuctionDuration;

    constructor() {
        // Default parameters
        currentDepositParams = DepositParams(0, 0, 0, 0);
        mockGetDepositState = IBridgeTypes.DepositState.ACTIVE;
        mockGetDepositAmount = defaultInitialAmount;
    }

    function revealDepositWithExtraData(
        IBridgeTypes.BitcoinTxInfo calldata /*_fundingTx*/,
        IBridgeTypes.DepositRevealInfo calldata /*_reveal*/,
        bytes32 /*_extraData*/
    ) external override returns (uint256 depositKey, uint256 initialAmount) {
        if (mockRevealDepositKey != 0) {
            return (mockRevealDepositKey, mockRevealInitialAmount);
        }
        depositKey = nextDepositKey++;
        initialAmount = defaultInitialAmount;
        return (depositKey, initialAmount);
    }

    function getDepositDetails(uint256 _depositKey)
        external
        view
        override
        returns (
            IBridgeTypes.DepositState state,
            uint256 amount,
            uint256 utxoSize,
            bytes32 extraData
        )
    {
        if (mockGetDepositExtraData_set && _depositKey != 0) { // Check if response is specifically set
             return (mockGetDepositState, mockGetDepositAmount, mockGetDepositUtxoSize, mockGetDepositExtraData);
        }
        if (depositDetailsStore[_depositKey].extraData != bytes32(0)) {
            DepositDetails memory stored = depositDetailsStore[_depositKey];
            return (stored.state, stored.amount, stored.utxoSize, stored.extraData);
        }
        return (IBridgeTypes.DepositState.ACTIVE, defaultInitialAmount, 0, bytes32(0));
    }

    function depositParameters()
        external
        view
        override
        returns (
            uint32 treasuryFeeDivisor,
            uint16 revealAheadPeriod,
            uint64 depositTxMaxFee,
            uint64 auctionDuration
        )
    {
         if (mockParamsDepositTxMaxFee_set) {
            return (mockParamsTreasuryFeeDivisor, mockParamsRevealAheadPeriod, mockParamsDepositTxMaxFee, mockParamsAuctionDuration);
        }
        return (currentDepositParams.treasuryFeeDivisor, currentDepositParams.revealAheadPeriod, currentDepositParams.depositTxMaxFee, currentDepositParams.auctionDuration);
    }

    // --- Mock control functions ---
    function setRevealDepositWithExtraDataResponse(uint256 key, uint256 amount) external {
        mockRevealDepositKey = key;
        mockRevealInitialAmount = amount;
    }

    bool private mockGetDepositExtraData_set = false;
    function setGetDepositDetailsResponse(IBridgeTypes.DepositState state, uint256 amount, uint256 utxoSize, bytes32 extraData) external {
        mockGetDepositState = state;
        mockGetDepositAmount = amount;
        mockGetDepositUtxoSize = utxoSize;
        mockGetDepositExtraData = extraData;
        mockGetDepositExtraData_set = true;
    }

    bool private mockParamsDepositTxMaxFee_set = false;
    function setDepositParametersResponse(uint32 divisor, uint16 period, uint64 maxFee, uint64 duration) external {
        mockParamsTreasuryFeeDivisor = divisor;
        mockParamsRevealAheadPeriod = period;
        mockParamsDepositTxMaxFee = maxFee;
        mockParamsAuctionDuration = duration;
        mockParamsDepositTxMaxFee_set = true;
    }

    function storeActualDepositDetails(uint256 key, IBridgeTypes.DepositState state, uint256 amount, bytes32 extraData) external {
        depositDetailsStore[key] = DepositDetails(state, amount, 0, extraData);
    }
} 