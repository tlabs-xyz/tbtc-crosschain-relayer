// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

interface IReimbursementPool {
    function refund(uint96 gasSpent, address receiver) external;
    function maxGasPrice() external view returns (uint256);
    function staticGas() external view returns (uint256);
}

abstract contract Reimbursable is OwnableUpgradeable {
    IReimbursementPool public reimbursementPool;

    modifier onlyReimbursableAdmin() virtual {
        // In a real scenario, this might be a separate admin role
        require(owner() == msg.sender, "Reimbursable: Caller is not the owner");
        _; 
    }

    function setReimbursementPool(address _reimbursementPool) external onlyReimbursableAdmin {
        reimbursementPool = IReimbursementPool(_reimbursementPool);
    }

    function _refundToGasSpent(uint256 refund) internal view virtual returns (uint256) {
        if (address(reimbursementPool) == address(0)) return 0;
        uint256 maxGasPrice = reimbursementPool.maxGasPrice();
        uint256 staticGas = reimbursementPool.staticGas();
        if (maxGasPrice == 0) return 0; // Avoid division by zero

        uint256 gasPrice = tx.gasprice < maxGasPrice ? tx.gasprice : maxGasPrice;
        if (gasPrice == 0) return 0;

        uint256 gasSpent = refund / gasPrice;
        return gasSpent > staticGas ? gasSpent - staticGas : 0;
    }

    // Mock initialize function for OwnableUpgradeable
    function __Reimbursable_init() internal onlyInitializing {
        __Ownable_init();
    }
} 