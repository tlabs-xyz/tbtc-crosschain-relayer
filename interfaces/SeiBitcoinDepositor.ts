// This ABI is for the Sei Bitcoin Depositor contract (L1BTCDepositorNttWithExecutor)
// deployed on Ethereum Mainnet for bridging to Sei Network via Wormhole NTT
// Pattern: NTT Hub & Spoke with Wormhole Executor
// 
// SDK Version: Updated to match solidity changes (removed utility functions, updated signatures)
export const SeiBitcoinDepositorABI = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'uint256',
        name: 'depositKey',
        type: 'uint256',
      },
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'destinationChainDepositOwner',
        type: 'bytes32',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'l1Sender',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'initialAmount',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'tbtcAmount',
        type: 'uint256',
      },
    ],
    name: 'DepositFinalized',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'uint256',
        name: 'depositKey',
        type: 'uint256',
      },
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'destinationChainDepositOwner',
        type: 'bytes32',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'l1Sender',
        type: 'address',
      },
    ],
    name: 'DepositInitialized',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'sender',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'nonce',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint16',
        name: 'destinationChain',
        type: 'uint16',
      },
      {
        indexed: false,
        internalType: 'bytes32',
        name: 'actualRecipient',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'uint64',
        name: 'transferSequence',
        type: 'uint64',
      },
      {
        indexed: false,
        internalType: 'bytes32',
        name: 'encodedReceiver',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'executorCost',
        type: 'uint256',
      },
    ],
    name: 'TokensTransferredNttWithExecutor',
    type: 'event',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    name: 'deposits',
    outputs: [
      {
        internalType: 'enum AbstractL1BTCDepositor.DepositState',
        name: '',
        type: 'uint8',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'depositKey',
        type: 'uint256',
      },
    ],
    name: 'finalizeDeposit',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: 'bytes4',
            name: 'version',
            type: 'bytes4',
          },
          {
            internalType: 'bytes',
            name: 'inputVector',
            type: 'bytes',
          },
          {
            internalType: 'bytes',
            name: 'outputVector',
            type: 'bytes',
          },
          {
            internalType: 'bytes4',
            name: 'locktime',
            type: 'bytes4',
          },
        ],
        internalType: 'struct IBridgeTypes.BitcoinTxInfo',
        name: 'fundingTx',
        type: 'tuple',
      },
      {
        components: [
          {
            internalType: 'uint32',
            name: 'fundingOutputIndex',
            type: 'uint32',
          },
          {
            internalType: 'bytes8',
            name: 'blindingFactor',
            type: 'bytes8',
          },
          {
            internalType: 'bytes20',
            name: 'walletPubKeyHash',
            type: 'bytes20',
          },
          {
            internalType: 'bytes20',
            name: 'refundPubKeyHash',
            type: 'bytes20',
          },
          {
            internalType: 'bytes4',
            name: 'refundLocktime',
            type: 'bytes4',
          },
          {
            internalType: 'address',
            name: 'vault',
            type: 'address',
          },
        ],
        internalType: 'struct IBridgeTypes.DepositRevealInfo',
        name: 'reveal',
        type: 'tuple',
      },
      {
        internalType: 'bytes32',
        name: 'destinationChainDepositOwner',
        type: 'bytes32',
      },
    ],
    name: 'initializeDeposit',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'bridge',
    outputs: [
      {
        internalType: 'contract IBridge',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'tbtcVault',
    outputs: [
      {
        internalType: 'contract ITBTCVault',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'tbtcToken',
    outputs: [
      {
        internalType: 'contract IERC20Upgradeable',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'nttManagerWithExecutor',
    outputs: [
      {
        internalType: 'contract INttManagerWithExecutor',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'underlyingNttManager',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'defaultSupportedChain',
    outputs: [
      {
        internalType: 'uint16',
        name: '',
        type: 'uint16',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint16',
        name: '',
        type: 'uint16',
      },
    ],
    name: 'supportedChains',
    outputs: [
      {
        internalType: 'bool',
        name: '',
        type: 'bool',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'parameterExpirationTime',
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
        internalType: 'address',
        name: 'user',
        type: 'address',
      },
    ],
    name: 'canUserStartNewWorkflow',
    outputs: [
      {
        internalType: 'bool',
        name: 'canStart',
        type: 'bool',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'user',
        type: 'address',
      },
    ],
    name: 'getUserWorkflowInfo',
    outputs: [
      {
        internalType: 'bool',
        name: 'hasActiveWorkflow',
        type: 'bool',
      },
      {
        internalType: 'bytes32',
        name: 'nonce',
        type: 'bytes32',
      },
      {
        internalType: 'uint256',
        name: 'timestamp',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'timeRemaining',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'user',
        type: 'address',
      },
    ],
    name: 'getUserWorkflowStatus',
    outputs: [
      {
        internalType: 'bool',
        name: 'hasActiveWorkflow',
        type: 'bool',
      },
      {
        internalType: 'bytes32',
        name: 'nonce',
        type: 'bytes32',
      },
      {
        internalType: 'uint256',
        name: 'timestamp',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'areExecutorParametersSet',
    outputs: [
      {
        internalType: 'bool',
        name: 'isSet',
        type: 'bool',
      },
      {
        internalType: 'bytes32',
        name: 'nonce',
        type: 'bytes32',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getStoredExecutorValue',
    outputs: [
      {
        internalType: 'uint256',
        name: 'value',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint16',
        name: 'destinationChain',
        type: 'uint16',
      },
    ],
    name: 'quoteFinalizeDeposit',
    outputs: [
      {
        internalType: 'uint256',
        name: 'cost',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'quoteFinalizeDeposit',
    outputs: [
      {
        internalType: 'uint256',
        name: 'cost',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint16',
        name: 'destinationChain',
        type: 'uint16',
      },
    ],
    name: 'quoteFinalizedDeposit',
    outputs: [
      {
        internalType: 'uint256',
        name: 'nttDeliveryPrice',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'executorCost',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'totalCost',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

