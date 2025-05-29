export const IStarkGateBridgeABI = [
  // Functions based on new contracts/cross-chain/starknet/interfaces/IStarkGateBridge.sol
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { internalType: 'address', name: 'token', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
      { internalType: 'uint256', name: 'l2Recipient', type: 'uint256' },
    ],
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
  },
  {
    name: 'depositWithMessage',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { internalType: 'address', name: 'token', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
      { internalType: 'uint256', name: 'l2Recipient', type: 'uint256' },
      { internalType: 'uint256[]', name: 'message', type: 'uint256[]' },
    ],
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
  },
  {
    name: 'estimateMessageFee',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
  },
  {
    name: 'depositWithMessageCancelRequest',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { internalType: 'address', name: 'token', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
      { internalType: 'uint256', name: 'l2Recipient', type: 'uint256' },
      { internalType: 'uint256[]', name: 'message', type: 'uint256[]' },
      { internalType: 'uint256', name: 'nonce', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'l1ToL2MessageNonce',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
  },
  {
    name: 'isDepositCancellable',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ internalType: 'uint256', name: 'nonce', type: 'uint256' }],
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
  },
  
  // Functions from StarkNetBitcoinDepositor.sol that are called via this interface
  {
    name: 'initializeDeposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { internalType: 'bytes', name: 'fundingTx', type: 'bytes' },
      { internalType: 'bytes', name: 'reveal', type: 'bytes' },
      { internalType: 'bytes32', name: 'l2DepositOwner', type: 'bytes32' },
    ],
    outputs: [],
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
    stateMutability: 'nonpayable',
    inputs: [{ internalType: 'uint256', name: 'newFee', type: 'uint256' }],
    outputs: [],
  },
  
  // Events
  {
    name: 'TBTCBridgedToStarkNet',
    type: 'event',
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'bytes32', name: 'depositKey', type: 'bytes32' },
      { indexed: true, internalType: 'uint256', name: 'starkNetRecipient', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'messageNonce', type: 'uint256' },
    ],
  },
];
