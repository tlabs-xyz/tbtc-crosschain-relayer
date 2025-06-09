import { ethers } from 'ethers';
import { type Deposit } from '../types/Deposit.type.js';
import { type FundingTransaction } from '../types/FundingTransaction.type.js';
import { getFundingTxHash, getTransactionHash } from './GetTransactionHash.js';
import { DepositStore } from './DepositStore.js';
import logger from './Logger.js';
import { DepositStatus } from '../types/DepositStatus.enum.js';
import {
  logDepositCreated,
  logStatusChange,
  logDepositInitialized,
  logDepositFinalized,
  logDepositAwaitingWormholeVAA,
  logDepositBridged,
} from './AuditLog.js';
import { type Reveal } from '../types/Reveal.type.js';

// Type for transaction objects with hash property
interface TransactionWithHash {
  hash: string;
}

/**
 * @name createDeposit
 * @description Creates a new deposit object with the data provided by the event listener.
 * This function takes a funding transaction, reveal parameters, L2 deposit owner, and L2 sender information,
 * and constructs a structured Deposit object. The Deposit object includes transaction hashes, receipt details,
 * event data, ownership information, status, and timestamps.
 *
 * @param {FundingTransaction} fundingTx - The Bitcoin funding transaction.
 * @param {Reveal} reveal - An object containing reveal parameters related to the Bitcoin deposit.
 * @param {string} l2DepositOwner - The owner of the deposit on the L2 network.
 * @param {string} l2Sender - The sender address on the L2 network.
 * @param {string} chainId - The chain ID of the deposit.
 *
 * @returns {Deposit} A structured deposit object containing detailed information for various uses in the system.
 */

export const createDeposit = (
  fundingTx: FundingTransaction,
  reveal: Reveal,
  l2DepositOwner: string,
  l2Sender: string,
  chainId: string,
): Deposit => {
  const fundingTxHash = getFundingTxHash(fundingTx);
  const depositId = getDepositId(fundingTxHash, reveal.fundingOutputIndex);
  const deposit: Deposit = {
    id: depositId,
    chainId: chainId,
    fundingTxHash: fundingTxHash,
    outputIndex: reveal.fundingOutputIndex,
    hashes: {
      btc: {
        btcTxHash: getTransactionHash(fundingTx),
      },
      eth: {
        initializeTxHash: null,
        finalizeTxHash: null,
      },
      solana: {
        bridgeTxHash: null,
      },
    },
    receipt: {
      depositor: l2Sender,
      blindingFactor: reveal.blindingFactor,
      walletPublicKeyHash: reveal.walletPubKeyHash,
      refundPublicKeyHash: reveal.refundPubKeyHash,
      refundLocktime: reveal.refundLocktime,
      extraData: l2DepositOwner,
    },
    L1OutputEvent: {
      fundingTx: {
        version: fundingTx.version,
        inputVector: fundingTx.inputVector,
        outputVector: fundingTx.outputVector,
        locktime: fundingTx.locktime,
      },
      reveal: reveal,
      l2DepositOwner: l2DepositOwner,
      l2Sender: l2Sender,
    },
    owner: l2DepositOwner,
    status: DepositStatus.QUEUED,
    dates: {
      createdAt: Date.now(),
      initializationAt: null,
      finalizationAt: null,
      lastActivityAt: Date.now(),
      awaitingWormholeVAAMessageSince: null,
      bridgedAt: null,
    },
    wormholeInfo: {
      txHash: null,
      transferSequence: null,
      bridgingAttempted: false,
    },
    error: null,
  };

  // --- Log Deposit Creation ---
  logDepositCreated(deposit);
  // --- End Log ---

  return deposit;
};

/**
 * @name updateToFinalizedDeposit
 * @description Updates the status of a deposit to "FINALIZED" and records the finalization transaction hash.
 * This function takes a deposit object and a transaction object, updates the deposit status to "FINALIZED",
 * records the finalization timestamp, and stores the finalization transaction hash in the deposit object.
 * The updated deposit object is then written to the JSON storage.
 * @param {Deposit} deposit - The deposit object to be updated.
 * @param {TransactionWithHash} tx - The transaction object containing the finalization transaction hash.
 */
export const updateToFinalizedDeposit = async (
  deposit: Deposit,
  tx?: TransactionWithHash,
  error?: string,
) => {
  const oldStatus = deposit.status; // Capture old status before changes
  const newStatus = tx ? DepositStatus.FINALIZED : deposit.status;
  const newFinalizationAt = tx ? Date.now() : deposit.dates.finalizationAt;
  const newHash = tx
    ? {
        ...deposit.hashes,
        eth: {
          ...deposit.hashes.eth,
          finalizeTxHash: tx?.hash ? tx.hash : null,
        },
      }
    : deposit.hashes;

  const updatedDeposit: Deposit = {
    ...deposit,
    status: newStatus,
    dates: {
      ...deposit.dates,
      finalizationAt: newFinalizationAt,
      lastActivityAt: Date.now(),
    },
    hashes: newHash,
    error: error ? error : null,
  };

  // Log status change if it actually changed
  if (newStatus !== oldStatus) {
    logStatusChange(updatedDeposit, newStatus, oldStatus);
  }

  await DepositStore.update(updatedDeposit);

  if (tx) {
    logger.info(`Deposit has been finalized | Id: ${deposit.id} | Hash: ${tx.hash}`);
    // --- Log Deposit Finalized ---
    logDepositFinalized(updatedDeposit);
    // --- End Log ---
  }
  // Note: No specific log if only error was updated
};

/**
 * @name updateToInitializedDeposit
 * @description Updates the status of a deposit to "INITIALIZED" and records the initialization transaction hash.
 * This function takes a deposit object and a transaction object, updates the deposit status to "INITIALIZED",
 * records the initialization timestamp, and stores the initialization transaction hash in the deposit object.
 * The updated deposit object is then written to the JSON storage.
 * @param {Deposit} deposit - The deposit object to be updated.
 * @param {TransactionWithHash} tx - The transaction object containing the initialization transaction hash.
 */
export const updateToInitializedDeposit = async (
  deposit: Deposit,
  tx?: TransactionWithHash,
  error?: string,
) => {
  const oldStatus = deposit.status; // Capture old status before changes
  const newStatus = tx ? DepositStatus.INITIALIZED : deposit.status;
  const newInitializationAt = tx ? Date.now() : deposit.dates.initializationAt;
  const newHash = tx
    ? {
        ...deposit.hashes,
        eth: {
          ...deposit.hashes.eth,
          initializeTxHash: tx?.hash ? tx.hash : null,
        },
      }
    : deposit.hashes;

  const updatedDeposit: Deposit = {
    ...deposit,
    status: newStatus,
    dates: {
      ...deposit.dates,
      initializationAt: newInitializationAt,
      lastActivityAt: Date.now(),
    },
    hashes: newHash,
    error: error ? error : null,
  };

  // Log status change if it actually changed
  if (newStatus !== oldStatus) {
    logStatusChange(updatedDeposit, newStatus, oldStatus);
  }

  await DepositStore.update(updatedDeposit);

  if (tx) {
    logger.info(`Deposit has been initialized | Id: ${deposit.id} | Hash: ${tx.hash}`);
    // --- Log Deposit Initialized ---
    logDepositInitialized(updatedDeposit);
    // --- End Log ---
  }
  // Note: No specific log if only error was updated
};

/**
 * @name updateToAwaitingWormholeVAA
 * @description Updates the status of a deposit to `AWAITING_WORMHOLE_VAA` and
 * stores the Wormhole transfer sequence (so we can fetch the VAA later).
 *
 * - Sets deposit status to AWAITING_WORMHOLE_VAA
 * - Records lastActivityAt
 * - Clears error
 * - Updates or creates `wormholeInfo.transferSequence`
 * - Writes the updated deposit object to JSON storage
 *
 * @param deposit The deposit object to update
 * @param transferSequence The Wormhole transfer sequence ID
 * @param bridgingAttempted Whether bridging was already attempted (default: false)
 */
export const updateToAwaitingWormholeVAA = async (
  txHash: string,
  deposit: Deposit,
  transferSequence: string,
  bridgingAttempted: boolean = false,
): Promise<void> => {
  const oldStatus = deposit.status;
  const newStatus = DepositStatus.AWAITING_WORMHOLE_VAA;

  // Update (or create) wormholeInfo
  const newWormholeInfo = {
    ...deposit.wormholeInfo,
    txHash,
    transferSequence,
    bridgingAttempted,
  };

  const updatedDeposit: Deposit = {
    ...deposit,
    status: newStatus,
    wormholeInfo: newWormholeInfo,
    error: null, // clear any previous error
    dates: {
      ...deposit.dates,
      lastActivityAt: Date.now(),
      awaitingWormholeVAAMessageSince: Date.now(),
    },
  };

  // Log status change if it actually changed
  if (newStatus !== oldStatus) {
    logStatusChange(updatedDeposit, newStatus, oldStatus);
  }

  // Write to JSON file
  await DepositStore.update(updatedDeposit);

  logger.info(
    `Deposit has been moved to AWAITING_WORMHOLE_VAA | ID: ${deposit.id} | sequence: ${transferSequence}`,
  );

  logDepositAwaitingWormholeVAA(updatedDeposit);
};

/**
 * @name updateToBridgedDeposit
 * @description Updates the status of a deposit to `BRIDGED`
 *
 * - Sets deposit status to BRIDGED
 * - Records lastActivityAt
 * - Clears error
 * - Updates or creates `wormholeInfo.transferSequence`
 * - Writes the updated deposit object to JSON storage
 *
 * @param deposit The deposit object to update
 * @param transferSequence The Wormhole transfer sequence ID
 * @param bridgingAttempted Whether bridging was already attempted (default: false)
 */
export const updateToBridgedDeposit = async (
  deposit: Deposit,
  txSignature: string,
): Promise<void> => {
  const oldStatus = deposit.status;
  const newStatus = DepositStatus.BRIDGED;

  const newSolanaHashes = {
    ...deposit.hashes?.solana,
    bridgeTxHash: txSignature,
  };

  const updatedDeposit: Deposit = {
    ...deposit,
    status: newStatus,
    wormholeInfo: {
      ...deposit.wormholeInfo,
      bridgingAttempted: true,
    },
    hashes: {
      ...deposit.hashes,
      solana: newSolanaHashes,
    },
    error: null, // clear any previous error
    dates: {
      ...deposit.dates,
      lastActivityAt: Date.now(),
      bridgedAt: Date.now(),
    },
  };

  // Log status change if it actually changed
  if (newStatus !== oldStatus) {
    logStatusChange(updatedDeposit, newStatus, oldStatus);
  }

  // Write to JSON file
  await DepositStore.update(updatedDeposit);

  logger.info(`Deposit has been moved to BRIDGED | ID: ${deposit.id}`);

  logDepositBridged(updatedDeposit);
};

/**
 * @name updateLastActivity
 * @description Updates the last activity timestamp of a deposit.
 * This function takes a deposit object and updates the last activity timestamp to the current time.
 * The updated deposit object is then written to the JSON storage.
 * @param {Deposit} deposit - The deposit object to be updated.
 */
export const updateLastActivity = async (deposit: Deposit): Promise<Deposit> => {
  const updatedDeposit: Deposit = {
    ...deposit,
    dates: {
      ...deposit.dates,
      lastActivityAt: Date.now(),
    },
  };

  await DepositStore.update(updatedDeposit);
  return updatedDeposit;
};

/**
 * Utility to reverse a hex string (excluding the 0x prefix).
 * Used to convert Bitcoin transaction hashes from big-endian to little-endian format.
 *
 * @param hex The hex string to reverse (must be 0x-prefixed and even length, minimum 2 bytes)
 * @returns The reversed hex string
 * @throws {Error} If the hex string is invalid
 *
 * @example
 * ```typescript
 * reverseHexString('0xabcdef12') // Returns '0x12efcdab'
 * ```
 */
function reverseHexString(hex: string): string {
  if (typeof hex !== 'string') {
    throw new Error('Input must be a string');
  }
  if (!hex.startsWith('0x')) {
    throw new Error('Hex string must be 0x-prefixed');
  }
  if (hex.length < 4) {
    throw new Error('Hex string must contain at least one byte after 0x');
  }
  if (hex.length % 2 !== 0) {
    throw new Error('Hex string must have even length');
  }
  const hexBody = hex.slice(2);
  const pairs = hexBody.match(/.{2}/g);
  if (!pairs) {
    throw new Error('Failed to parse hex string into byte pairs');
  }
  return '0x' + pairs.reverse().join('');
}

/**
 * Converts a deposit's keccak256 hash (deposit key) into a uint256 string representation,
 * which serves as the unique deposit ID in the system. It calls `getDepositKey`
 * to generate the underlying `bytes32` hash.
 * This ID is used for tracking and storage.
 *
 * @param {string} fundingTxHash - The 66-character hex string of the Bitcoin funding transaction hash (0x-prefixed, 32 bytes).
 *                                 Must be in big-endian; will be reversed for little-endian.
 * @param {number} fundingOutputIndex - The index of the output in the funding transaction (must be >= 0 and <= 0xffffffff).
 * @returns {string} A unique deposit ID as a uint256 string.
 * @throws {Error} If the fundingTxHash is not a valid 66-character hex string or fundingOutputIndex is invalid.
 *
 * @example
 * ```typescript
 * getDepositId('0xabcdef...123456', 0)
 * ```
 */
export const getDepositId = (fundingTxHash: string, fundingOutputIndex: number): string => {
  const hashBytes32 = getDepositKey(fundingTxHash, fundingOutputIndex);
  return ethers.BigNumber.from(hashBytes32).toString();
};

/**
 * Generates a deposit key by hashing the Bitcoin funding transaction hash and output index
 * using keccak256. This key is a `bytes32` value used for on-chain interactions.
 * For EVM chains, pass reverse=true to match contract expectations.
 * For StarkNet, always use reverse=false.
 *
 * @param {string} fundingTxHash - The 66-character hex string of the Bitcoin funding transaction hash (0x-prefixed, 32 bytes).
 * @param {number} fundingOutputIndex - The index of the output in the funding transaction (must be >= 0 and <= 0xffffffff).
 * @param {boolean} reverse - Whether to reverse the hash (EVM: true, StarkNet: false)
 * @returns {string} The deposit key as a `bytes32` hex string.
 */
export const getDepositKey = (
  fundingTxHash: string,
  fundingOutputIndex: number,
  reverse: boolean = true,
): string => {
  // Validate fundingTxHash
  if (typeof fundingTxHash !== 'string') {
    throw new Error('fundingTxHash must be a string');
  }
  if (!ethers.utils.isHexString(fundingTxHash) || fundingTxHash.length !== 66) {
    throw new Error('fundingTxHash must be a 66-character hex string (e.g. 0x...)');
  }
  // Validate fundingOutputIndex
  if (!Number.isInteger(fundingOutputIndex) || fundingOutputIndex < 0) {
    throw new Error('fundingOutputIndex must be a non-negative integer');
  }
  if (fundingOutputIndex > 0xffffffff) {
    throw new Error('fundingOutputIndex must fit in uint32 range');
  }

  let hashToUse = fundingTxHash;
  if (reverse) {
    hashToUse = reverseHexString(fundingTxHash);
  }
  // Use uint32 for output index to match on-chain contract
  const types = ['bytes32', 'uint32'];
  const values = [hashToUse, fundingOutputIndex];
  return ethers.utils.solidityKeccak256(types, values);
};
