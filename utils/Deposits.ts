import { ethers } from 'ethers';
import { type Deposit } from '../types/Deposit.type';
import { type FundingTransaction } from '../types/FundingTransaction.type';
import { getFundingTxHash, getTransactionHash } from './GetTransactionHash';
import { DepositStore } from './DepositStore';
import logger from './Logger';
import { DepositStatus } from '../types/DepositStatus.enum';
import {
  logDepositCreated,
  logStatusChange,
  logDepositInitialized,
  logDepositFinalized,
  logDepositAwaitingWormholeVAA,
  logDepositBridged,
} from './AuditLog';
import { type Reveal } from '../types/Reveal.type';

/**
 * @name createDeposit
 * @description Creates a new deposit object with the data provided by the event listener.
 * This function takes a funding transaction, reveal parameters, L2 deposit owner, and L2 sender information,
 * and constructs a structured Deposit object. The Deposit object includes transaction hashes, receipt details,
 * event data, ownership information, status, and timestamps.
 *
 * @param {FundingTransaction} fundingTx - The Bitcoin funding transaction.
 * @param {Reveal} reveal - An object containing reveal parameters related to the Bitcoin deposit.
 * @param {any} l2DepositOwner - The owner of the deposit on the L2 network.
 * @param {any} l2Sender - The sender address on the L2 network.
 * @param {string} chainName - The chain name of the deposit.
 *
 * @returns {Deposit} A structured deposit object containing detailed information for various uses in the system.
 */

export const createDeposit = (
  fundingTx: FundingTransaction,
  reveal: Reveal,
  l2DepositOwner: any,
  l2Sender: any,
  chainName: string,
): Deposit => {
  const fundingTxHash = getFundingTxHash(fundingTx);
  const depositId = getDepositId(fundingTxHash, reveal.fundingOutputIndex);
  const deposit: Deposit = {
    id: depositId,
    chainName: chainName,
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
 * @param {any} tx - The transaction object containing the finalization transaction hash.
 */
export const updateToFinalizedDeposit = async (deposit: Deposit, tx?: any, error?: string) => {
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
 * @param {any} tx - The transaction object containing the initialization transaction hash.
 */
export const updateToInitializedDeposit = async (deposit: Deposit, tx?: any, error?: string) => {
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
 * @name getDepositId
 * @description Generates a unique deposit ID by encoding the Bitcoin funding transaction hash and output index,
 * then hashing the result using keccak256.
 *
 * @param {string} fundingTxHash - The 64-character hex string of the Bitcoin funding transaction hash.
 * @param {number} fundingOutputIndex - The index of the output in the funding transaction.
 *
 * @returns {string} A unique deposit ID as a uint256 string.
 *
 * @throws {Error} If the fundingTxHash is not a 66-character hex string (e.g. 0x...).
 */

export const getDepositId = (fundingTxHash: string, fundingOutputIndex: number): string => {
  // The deposit ID is a keccak256 hash of the funding transaction hash and output index.
  // The tBTC OptimisticMintingFinalized event emits depositKey as uint256.
  // To ensure matching, we calculate the bytes32 keccak256 hash and then convert it
  // to its BigNumber (uint256) decimal string representation.

  // Validate fundingTxHash
  if (!ethers.utils.isHexString(fundingTxHash) || fundingTxHash.length !== 66) {
    throw new Error('fundingTxHash must be a 66-character hex string (e.g. 0x...).');
  }

  const types = ['bytes32', 'uint256'];
  const values = [fundingTxHash, fundingOutputIndex];

  const hashBytes32 = ethers.utils.solidityKeccak256(types, values);
  return ethers.BigNumber.from(hashBytes32).toString();
};
