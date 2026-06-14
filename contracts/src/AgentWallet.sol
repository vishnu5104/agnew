// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

interface IAgentShield {
    function checkAndRecord(address merchant, uint256 amount) external returns (bool);
    function checkAndRecordString(string calldata merchantName, address merchantAddress, uint256 amount) external returns (bool);
}

contract AgentWallet {
    address public owner;
    IAgentShield public shield;

    event TransactionExecuted(address indexed dest, uint256 amount, bytes data, bytes result);
    event ShieldUpdated(address indexed oldShield, address indexed newShield);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error WalletOnlyOwner();
    error WalletExecutionFailed();
    error WalletInvalidAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert WalletOnlyOwner();
        _;
    }

    constructor(address _shield) {
        if (_shield == address(0)) revert WalletInvalidAddress();
        owner = msg.sender;
        shield = IAgentShield(_shield);
    }

    function setShield(address _newShield) external onlyOwner {
        if (_newShield == address(0)) revert WalletInvalidAddress();
        emit ShieldUpdated(address(shield), _newShield);
        shield = IAgentShield(_newShield);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert WalletInvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /**
     * @notice Executes a transaction by passing address-based reputation/policy check first.
     */
    function execute(address payable dest, uint256 amount, bytes calldata data) external onlyOwner returns (bytes memory) {
        // Run shield validation
        shield.checkAndRecord(dest, amount);

        // Execute transaction
        (bool success, bytes memory result) = dest.call{value: amount}(data);
        if (!success) revert WalletExecutionFailed();

        emit TransactionExecuted(dest, amount, data, result);
        return result;
    }

    /**
     * @notice Executes a transaction by passing string-based name reputation check first.
     */
    function executeWithString(string calldata merchantName, address payable dest, uint256 amount, bytes calldata data) external onlyOwner returns (bytes memory) {
        // Run shield validation with string name
        shield.checkAndRecordString(merchantName, dest, amount);

        // Execute transaction
        (bool success, bytes memory result) = dest.call{value: amount}(data);
        if (!success) revert WalletExecutionFailed();

        emit TransactionExecuted(dest, amount, data, result);
        return result;
    }

    receive() external payable {}
}
