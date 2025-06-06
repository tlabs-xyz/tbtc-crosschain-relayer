import type { BigNumber } from 'ethers';

/**
 * Parameters for the DepositInitialized event emitted by AbstractL1BTCDepositor
 * (and inherited by StarkNetBitcoinDepositor).
 */
export interface DepositInitializedParams {
  /**
   * The unique identifier for the deposit.
   * Note: This is uint256 in the AbstractL1BTCDepositor event.
   * It needs to be handled consistently with the bytes32 depositKey in TBTCBridgedToStarkNet
   * and the string ID used in DepositStore.
   */
  depositKey: BigNumber; // uint256
  destinationChainDepositOwner: string; // bytes32 (StarkNet recipient address as bytes32 on L1)
  l1Sender: string; // address
}

/**
 * Parameters for the DepositFinalized event emitted by AbstractL1BTCDepositor
 * (and inherited by StarkNetBitcoinDepositor).
 */
export interface DepositFinalizedParams {
  /**
   * The unique identifier for the deposit.
   * Note: This is uint256 in the AbstractL1BTCDepositor event.
   */
  depositKey: BigNumber; // uint256
  destinationChainDepositOwner: string; // bytes32
  l1Sender: string; // address
  initialAmount: BigNumber; // uint256 (Amount from Bitcoin tx)
  tbtcAmount: BigNumber; // uint256 (Amount of tBTC minted)
}

/**
 * Parameters for the TBTCBridgedToStarkNet event emitted by StarkNetBitcoinDepositor.
 */
export interface TBTCBridgedToStarkNetParams {
  /**
   * The unique identifier for the deposit.
   * Note: This is bytes32 in the StarkNetBitcoinDepositor event.
   */
  depositKey: string; // bytes32
  starkNetRecipient: BigNumber; // uint256 (StarkNet recipient address as uint256 for StarkGate)
  amount: BigNumber; // uint256
  messageNonce: BigNumber; // uint256
}
