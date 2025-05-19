export const L1BitcoinRedeemerABI = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'l2Identifier',
        type: 'bytes32',
      },
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'walletPubKeyHash',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'bytes',
        name: 'redeemerOutputScript',
        type: 'bytes',
      },
      {
        indexed: false,
        internalType: 'uint64',
        name: 'requestedAmount',
        type: 'uint64',
      },
      {
        indexed: false,
        internalType: 'uint64',
        name: 'treasuryFee',
        type: 'uint64',
      },
      {
        indexed: false,
        internalType: 'uint64',
        name: 'txMaxFee',
        type: 'uint64',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'redeemer',
        type: 'address',
      },
    ],
    name: 'L2RedemptionFinalized',
    type: 'event',
  },
  {
    inputs: [
      { internalType: 'bytes32', name: 'l2Identifier', type: 'bytes32' },
      { internalType: 'bytes32', name: 'walletPubKeyHash', type: 'bytes32' },
      { internalType: 'bytes', name: 'redeemerOutputScript', type: 'bytes' },
      { internalType: 'uint64', name: 'requestedAmount', type: 'uint64' },
      { internalType: 'uint64', name: 'treasuryFee', type: 'uint64' },
      { internalType: 'uint64', name: 'txMaxFee', type: 'uint64' },
      { internalType: 'address', name: 'redeemer', type: 'address' },
    ],
    name: 'finalizeL2Redemption',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;
