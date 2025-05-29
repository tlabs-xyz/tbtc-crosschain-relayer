// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "../integrator/ITBTCVault.sol";

contract MockTBTCVault is ITBTCVault {
    address private _tbtcToken;

    constructor(address initialTbtcToken) {
        _tbtcToken = initialTbtcToken;
    }

    function tbtcToken() external view override returns (address) {
        return _tbtcToken;
    }

    function setTbtcToken(address newTbtcToken) external {
        // In a real scenario, this would be ownable
        _tbtcToken = newTbtcToken;
    }
} 