// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

interface ITBTCVault {
    function tbtcToken() external view returns (address);
    // Add other functions if AbstractL1BTCDepositor directly calls them
    // For now, only tbtcToken() is explicitly used in the __AbstractL1BTCDepositor_initialize function.
} 