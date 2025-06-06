import type { FundingTransaction } from './FundingTransaction.type.js';
import type { Reveal } from './Reveal.type.js';
import { type DepositStatus } from './DepositStatus.enum.js';

/**
 * Represents a cross-chain tBTC deposit and its lifecycle state.
 */
export type Deposit = {
  /** Unique identifier for the deposit (derived from fundingTxHash and outputIndex) */
  id: string;
  /** Name of the blockchain network (e.g., 'Ethereum', 'StarkNet', etc.) */
  chainName: string;
  /** Hash of the Bitcoin funding transaction */
  fundingTxHash: string;
  /** Output index in the funding transaction */
  outputIndex: number;
  /** Transaction hashes for each supported chain */
  hashes: {
    /** Bitcoin transaction hash */
    btc: {
      btcTxHash: string;
    };
    /** Ethereum transaction hashes for initialization/finalization */
    eth: {
      initializeTxHash: string | null;
      finalizeTxHash: string | null;
    };
    /** Solana bridge transaction hash */
    solana: {
      bridgeTxHash: string | null;
    };
    /** StarkNet bridge and L2 transaction hashes (optional) */
    starknet?: {
      l1BridgeTxHash?: string | null;
      l2TxHash?: string | null;
    };
  };
  /** Details of the deposit receipt (depositor, blinding, keys, etc.) */
  receipt: {
    /** Address of the depositor */
    depositor: string;
    /** Blinding factor for the deposit */
    blindingFactor: string;
    /** Hash of the wallet public key */
    walletPublicKeyHash: string;
    /** Hash of the refund public key */
    refundPublicKeyHash: string;
    /** Refund locktime (as string for cross-chain compatibility) */
    refundLocktime: string;
    /** Extra data (chain-specific, e.g., L2 owner) */
    extraData: string;
  };
  /** Current owner of the deposit (may change during lifecycle) */
  owner: string;
  /** Current status of the deposit (see DepositStatus enum) */
  status: DepositStatus;
  /** Optional status message for additional context */
  statusMessage?: string;
  /** L1 output event details (if available) */
  L1OutputEvent: {
    /** Funding transaction details */
    fundingTx: FundingTransaction;
    /** Reveal parameters for the deposit */
    reveal: Reveal;
    /** L2 deposit owner address */
    l2DepositOwner: string;
    /** L2 sender address */
    l2Sender: string;
  } | null;
  /** Timestamps for deposit lifecycle events */
  dates: {
    /** Creation timestamp (epoch ms) */
    createdAt: EpochTimeStamp | null;
    /** Initialization timestamp (epoch ms) */
    initializationAt: EpochTimeStamp | null;
    /** Finalization timestamp (epoch ms) */
    finalizationAt: EpochTimeStamp | null;
    /** Awaiting Wormhole VAA message since (epoch ms) */
    awaitingWormholeVAAMessageSince: EpochTimeStamp | null;
    /** Bridged timestamp (epoch ms) */
    bridgedAt: EpochTimeStamp | null;
    /** Last activity timestamp (epoch ms) */
    lastActivityAt: EpochTimeStamp;
  };
  /** Wormhole bridge info for cross-chain transfers */
  wormholeInfo: {
    /** Wormhole transaction hash (if available) */
    txHash: string | null;
    /** Wormhole transfer sequence (if available) */
    transferSequence: string | null;
    /** Whether bridging has been attempted */
    bridgingAttempted: boolean;
  };
  /** Error message if the deposit is in an error state, otherwise null */
  error: string | null;
};

// =====================
// Deposit Types
// =====================
