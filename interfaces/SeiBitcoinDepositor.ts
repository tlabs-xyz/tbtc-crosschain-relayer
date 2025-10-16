// This ABI is for the Sei Bitcoin Depositor contract (L1BTCDepositorNttWithExecutor)
// deployed on Ethereum Mainnet for bridging to Sei Network via Wormhole NTT
// Pattern: NTT Hub & Spoke with Wormhole Executor
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
        internalType: 'address',
        name: 'destinationChainDepositOwner',
        type: 'address',
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
        internalType: 'address',
        name: 'destinationChainDepositOwner',
        type: 'address',
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
        internalType: 'bytes32',
        name: 'depositKey',
        type: 'bytes32',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'recipient',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint64',
        name: 'sequence',
        type: 'uint64',
      },
    ],
    name: 'TBTCBridgedViaNTT',
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
        internalType: 'enum AbstractTBTCDepositor.DepositState',
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
        internalType: 'address',
        name: 'destinationChainDepositOwner',
        type: 'address',
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
    name: 'nttManager',
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
    name: 'wormholeChainId',
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
] as const;

