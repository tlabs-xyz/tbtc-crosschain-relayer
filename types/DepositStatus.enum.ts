// types/DepositStatus.enum.ts - Enum for deposit lifecycle states
//
// Defines all possible states for a deposit in the L1BitcoinDepositor contract and related logic.

/**
 * Enum representing the possible states of a deposit in the L1BitcoinDepositor contract
 */
export enum DepositStatus {
  /** Deposit is queued and awaiting initialization */
  QUEUED = 0,
  /** Deposit has been initialized on-chain */
  INITIALIZED = 1,
  /** Deposit has been finalized on-chain */
  FINALIZED = 2,
  /** Deposit is awaiting Wormhole VAA message */
  AWAITING_WORMHOLE_VAA = 3,
  /** Deposit has been bridged via Wormhole */
  BRIDGED = 4,
  /** Error occurred while sending L1 transaction */
  ERROR_SENDING_L1_TX = 5,
  /** Generic error state for the deposit */
  ERROR = 6,
}
