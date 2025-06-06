// tests/mocks/ethersprojectExperimental.mock.ts

// This is a mock for the NonceManager from @ethersproject/experimental
// It's designed to be used with Jest's moduleNameMapper to replace the actual module.

export const NonceManager = jest.fn().mockImplementation((signer: any) => {
  // console.log('Custom Mock NonceManager constructor called with signer:', signer);
  let internalNonce = 0; // Simple internal nonce tracking for the mock

  return {
    // Mock essential methods used by BaseChainHandler (and potentially others)
    getTransactionCount: jest.fn().mockImplementation(async (blockTag?: string) => {
      // console.log('Custom Mock NonceManager.getTransactionCount called, returning:', internalNonce);
      // If the signer itself has a getTransactionCount, could delegate,
      // but for a simple NonceManager mock, managing its own nonce is often sufficient.
      // if (signer && typeof signer.getTransactionCount === 'function') {
      //   return signer.getTransactionCount(blockTag);
      // }
      return Promise.resolve(internalNonce);
    }),

    incrementTransactionCount: jest.fn().mockImplementation((count: number = 1) => {
      // console.log('Custom Mock NonceManager.incrementTransactionCount called, incrementing by:', count);
      internalNonce += count;
    }),

    // BaseChainHandler uses the NonceManager instance itself as a signer for ethers.Contract
    // So, the NonceManager mock instance needs to expose signer-like methods if the Contract uses them directly.
    // The key one is usually signTransaction if the contract instance is used to send transactions.
    // However, BaseChainHandler passes the NonceManager to `new ethers.Contract(...)`.
    // The `ethers.Contract` mock (in ethers.mock.ts) then uses this `signerOrProvider`.
    // Our `ethers.Contract` mock's connect method and constructor logic handle assigning this
    // to `instance.signer`. If that `instance.signer` (which is our NonceManager mock instance)
    // needs to sign, it would call its own `signTransaction`.

    // Let's ensure methods that a Signer typically has are available if Contract relies on them.
    // These should ideally delegate to the underlying `signer` passed to NonceManager.

    signTransaction: jest.fn().mockImplementation(async (transaction: any) => {
      // console.log('Custom Mock NonceManager.signTransaction delegating to underlying signer');
      if (signer && typeof signer.signTransaction === 'function') {
        // Important: The NonceManager itself usually handles the nonce part,
        // then asks the underlying signer to sign the transaction with the correct nonce.
        // This mock is simplified; a real NonceManager does more.
        // For testing, ensuring the call passes through might be enough.
        const txWithNonce = { ...transaction, nonce: internalNonce };
        // internalNonce++; // A real NonceManager increments after preparing the tx to sign
        return signer.signTransaction(txWithNonce);
      }
      // console.warn('Custom Mock NonceManager.signTransaction: underlying signer or signTransaction method not found.');
      return Promise.resolve('mockSignedTxByCustomNonceManager');
    }),

    getAddress: jest.fn().mockImplementation(async () => {
      if (signer && typeof signer.getAddress === 'function') {
        return signer.getAddress();
      }
      return Promise.resolve('0xMockAddressFromNonceManager');
    }),

    sendTransaction: jest.fn().mockImplementation(async (transaction: any) => {
      // console.log('Custom Mock NonceManager.sendTransaction delegating to underlying signer');
      if (signer && typeof signer.sendTransaction === 'function') {
        const txWithNonce = { ...transaction, nonce: internalNonce };
        // The NonceManager should increment the nonce *before* sending the transaction
        // and use that incremented nonce.
        // For robustness, a real NonceManager might fetch latest on-chain nonce if its internal one is stale.
        // This mock will use its internalNonce and then increment it.
        const result = await signer.sendTransaction(txWithNonce);
        internalNonce++; // Increment after successfully preparing to send
        return result;
      }
      // console.warn('Custom Mock NonceManager.sendTransaction: underlying signer or sendTransaction method not found.');
      return Promise.resolve({
        hash: '0xMockTxHashByCustomNonceManager',
        wait: async () => ({ status: 1 }),
      });
    }),

    // Add other signer methods if they are called on the NonceManager instance by ethers.Contract
    _isSigner: true, // Important for ethers.js v5 to identify it as a Signer-like object
    provider: signer?.provider, // Expose provider if the underlying signer has one
    connect: jest.fn(function (this: any, provider: any) {
      // Allow connecting to a new provider
      if (signer && typeof signer.connect === 'function') {
        // this.signer = signer.connect(provider); // This would create a new signer instance
        // For NonceManager, it usually means the underlying signer connects.
        // And NonceManager itself might get a new provider reference.
      }
      this.provider = provider; // Naive connect for the mock
      return this;
    }),
    // Potentially more methods: estimateGas, call, getFeeData, etc., if used.
  };
});

// If BaseChainHandler or other parts of the code import other things from '@ethersproject/experimental',
// they need to be mocked and exported here as well.
// For example:
// export const someOtherExperimentalFunction = jest.fn();

// By default, ensure any other named exports that might be expected are present,
// even if just as simple jest.fn(). This prevents "is not a function" errors
// if the actual module exports more than just NonceManager and your code uses them.
// However, be careful with this as it can hide missing mocks.
// A more robust way is to find what jest.requireActual('@ethersproject/experimental') exports
// and mock only what's needed, or mock all of them explicitly.

// For now, we primarily care about NonceManager.
