export const StarkNetBitcoinDepositorABI = [
  {
    inputs: [
      {
        internalType: 'address',
        name: '_tbtcBridge',
        type: 'address',
      },
      {
        internalType: 'address',
        name: '_tbtcVault',
        type: 'address',
      },
      {
        internalType: 'address',
        name: '_starkGateBridge',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: '_starkNetTBTCToken',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: '_l1ToL2MessageFee',
        type: 'uint256',
      },
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'quoteFinalizeDeposit',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'newFee',
        type: 'uint256',
      },
    ],
    name: 'updateL1ToL2MessageFee',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'newBuffer',
        type: 'uint256',
      },
    ],
    name: 'updateFeeBuffer',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'depositKey',
        type: 'bytes32',
      },
      {
        indexed: true,
        internalType: 'uint256',
        name: 'starkNetRecipient',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'messageNonce',
        type: 'uint256',
      },
    ],
    name: 'TBTCBridgedToStarkNet',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        internalType: 'uint256',
        name: 'newFee',
        type: 'uint256',
      },
    ],
    name: 'L1ToL2MessageFeeUpdated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        internalType: 'uint256',
        name: 'newBuffer',
        type: 'uint256',
      },
    ],
    name: 'FeeBufferUpdated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        internalType: 'address',
        name: 'starkGateBridge',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'starkNetTBTCToken',
        type: 'uint256',
      },
    ],
    name: 'StarkNetBitcoinDepositorInitialized',
    type: 'event',
  },
];
