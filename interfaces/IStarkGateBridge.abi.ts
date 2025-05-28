export const IStarkGateBridgeABI = [
  // Functions
  {
    name: 'initializeDeposit',
    type: 'function',
    stateMutability: 'nonpayable', // Assuming non-payable unless specified
    inputs: [
      { internalType: 'bytes', name: 'fundingTx', type: 'bytes' },
      { internalType: 'bytes', name: 'reveal', type: 'bytes' },
      { internalType: 'bytes32', name: 'l2DepositOwner', type: 'bytes32' },
    ],
    outputs: [], // Assuming no specific return value for tx, ethers.ContractTransaction is handled by ethers.js
  },
  {
    name: 'finalizeDeposit',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ internalType: 'bytes32', name: 'depositKey', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'quoteFinalizeDeposit',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
  },
  {
    name: 'l1ToL2MessageFee',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
  },
  {
    name: 'updateL1ToL2MessageFee',
    type: 'function',
    stateMutability: 'nonpayable', // Assuming onlyOwner implies it's not view and could be non-payable
    inputs: [{ internalType: 'uint256', name: 'newFee', type: 'uint256' }],
    outputs: [],
  },
  // Event
  {
    name: 'TBTCBridgedToStarkNet',
    type: 'event',
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'bytes32', name: 'depositKey', type: 'bytes32' },
      // Based on IStarkGateBridge.ts filter, amount & starkNetRecipient are not indexed for filtering
      // but are part of the event data. The mock used id('TBTCBridgedToStarkNet(bytes32,uint256,bytes32)')
      // which implies types for signature but not indexing. Indexing is separate.
      { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' },
      { indexed: false, internalType: 'bytes32', name: 'starkNetRecipient', type: 'bytes32' },
    ],
  },
];
