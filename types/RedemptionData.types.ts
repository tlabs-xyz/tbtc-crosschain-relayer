import { ethers } from 'ethers';

export interface BitcoinTxUtxo {
  txHash: string; // bytes32 hex string
  txOutputIndex: number; // uint32
  txOutputValue: ethers.BigNumber; // uint64
}

export interface RedemptionRequestedEventData {
  walletPubKeyHash: string; // bytes20 hex string (e.g., "0x...")
  mainUtxo: BitcoinTxUtxo | string; // Modified to allow string for now to support existing mock '0x00...'
  redeemerOutputScript: string; // bytes hex string
  redeemer: string; // address
  requestedAmount: ethers.BigNumber; // uint256 or uint64 depending on source
  treasuryFee: ethers.BigNumber;
  txMaxFee: ethers.BigNumber;
  l2TransactionHash: string; // bytes32 hex string
  l2BlockNumber: number;
  l2Identifier: string; // The unique identifier from the L2 event (e.g. sequence for production)
  l1TokenAddress?: string; // Optional: Address of the L1 token involved in redemption
}
