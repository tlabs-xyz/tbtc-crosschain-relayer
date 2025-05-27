import type { FundingTransaction } from './FundingTransaction.type';
import type { Reveal } from './Reveal.type';
import { DepositStatus } from './DepositStatus.enum';

export type Deposit = {
  id: string;
  chainName: string;
  fundingTxHash: string;
  outputIndex: number;
  hashes: {
    btc: {
      btcTxHash: string;
    };
    eth: {
      initializeTxHash: string | null;
      finalizeTxHash: string | null;
    };
    solana: {
      bridgeTxHash: string | null;
    };
    starknet?: {
      l1BridgeTxHash?: string | null;
      l2TxHash?: string | null;
    };
  };
  receipt: {
    depositor: string;
    blindingFactor: string;
    walletPublicKeyHash: string;
    refundPublicKeyHash: string;
    refundLocktime: string;
    extraData: string;
  };
  owner: string;
  status: DepositStatus;
  L1OutputEvent: {
    fundingTx: FundingTransaction;
    reveal: Reveal;
    l2DepositOwner: string;
    l2Sender: string;
  };
  dates: {
    createdAt: EpochTimeStamp | null;
    initializationAt: EpochTimeStamp | null;
    finalizationAt: EpochTimeStamp | null;
    awaitingWormholeVAAMessageSince: EpochTimeStamp | null;
    bridgedAt: EpochTimeStamp | null;
    lastActivityAt: EpochTimeStamp;
  };
  wormholeInfo: {
    txHash: string | null;
    transferSequence: string | null;
    bridgingAttempted: boolean;
  };
  error: string | null;
};
