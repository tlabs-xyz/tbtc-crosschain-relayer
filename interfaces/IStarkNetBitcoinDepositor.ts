import type {
  Provider,
  // Signer, // Removed from @ethersproject/providers
} from '@ethersproject/providers';
import type {
  BaseContract,
  BigNumber,
  BigNumberish,
  BytesLike,
  CallOverrides,
  ContractTransaction,
  EventFilter,
  Overrides,
  PayableOverrides,
  PopulatedTransaction,
  Signer, // Added import from 'ethers'
  utils,
} from 'ethers'; // Using full ethers import
import type { FunctionFragment, EventFragment } from '@ethersproject/abi';

// Common type for events, assuming you might have a common types file or define it per interface
export type TypedEventFilter<_TEvent extends TypedEvent> = EventFilter;
export interface TypedEvent<TArgsArray extends Array<any> = any, TArgsObject = any> extends Event {
  args: TArgsArray & TArgsObject;
}
// export type TypedListener<TEvent extends TypedEvent> = (...listenerArg: [...Parameters<TEvent[" musste"]>,
// TEvent]) => void;
// export type OnEvent<TEvent extends TypedEvent> = (listener: TypedListener<TEvent>) => void;

// --- Structs Used in Contract Functions ---

/**
 * Corresponds to the `FundingTransaction` struct often used in L1 depositor contracts.
 * Ensure this matches the exact definition in your `AbstractL1BTCDepositor.sol` or related files if it's passed directly.
 * For `StarkNetBitcoinDepositor.initializeDeposit`, it appears to be passed as a tuple/array in the JS call.
 */
export type FundingTransactionStruct = {
  version: BigNumberish;
  inputVector: BytesLike;
  outputVector: BytesLike;
  locktime: BigNumberish;
};

export type FundingTransactionStructOutput = [BigNumber, string, string, BigNumber] & {
  version: BigNumber;
  inputVector: string;
  outputVector: string;
  locktime: BigNumber;
};

// --- Main Contract Interface (for ethers.utils.Interface) ---
export interface EthersStarkNetBitcoinDepositorInterface extends utils.Interface {
  functions: {
    // From StarkNetBitcoinDepositor itself
    'starkGateBridge()': FunctionFragment;
    'l2TbtcToken()': FunctionFragment;
    'l1ToL2MessageFee()': FunctionFragment;
    'depositStarkNetRecipients(bytes32)': FunctionFragment;
    'updateL1ToL2MessageFee(uint256)': FunctionFragment;
    'setDepositStateForTesting(uint256,uint8)': FunctionFragment; // Test helper
    'emitDepositInitializedForStarkNet(bytes32,uint256)': FunctionFragment; // Test helper

    // Overridden from AbstractL1BTCDepositor / AbstractBTCDepositor
    'quoteFinalizeDeposit()': FunctionFragment;

    // Inherited from AbstractL1BTCDepositor / AbstractBTCDepositor
    // (Add all public/external functions from parent contracts that are part of the interface)
    'initializeDeposit((uint256,bytes,bytes,uint256),bytes[5],bytes32)': FunctionFragment;
    'finalizeDeposit(bytes32)': FunctionFragment;
    'tbtcToken()': FunctionFragment;
    'tbtcVault()': FunctionFragment;
    'bridge()': FunctionFragment;
    'deposits(uint256)': FunctionFragment; // Assuming this is how DepositState is accessed
    'owner()': FunctionFragment;
    'paused()': FunctionFragment;
    'renounceOwnership()': FunctionFragment;
    'transferOwnership(address)': FunctionFragment;
    'pause()': FunctionFragment;
    'unpause()': FunctionFragment;
    // Potentially others like: 'isOwner()', 'getRoleAdmin()', etc. if using OpenZeppelin AccessControl more deeply
  };

  getFunction(nameOrSignatureOrTopic: string): FunctionFragment;

  events: {
    // From StarkNetBitcoinDepositor itself
    'StarkNetBitcoinDepositorInitialized(address,address,uint256)': EventFragment;
    'DepositInitializedForStarkNet(bytes32,uint256)': EventFragment;
    'DepositBridgedToStarkNet(bytes32,uint256,uint256,uint256)': EventFragment;
    'L1ToL2MessageFeeUpdated(uint256)': EventFragment;

    // Inherited from AbstractL1BTCDepositor / AbstractBTCDepositor & Ownable/Pausable
    // Ensure these match your actual parent contract events
    'DepositInitialized(bytes32,uint256,bytes,bytes,bytes32,uint256,address)': EventFragment; // Example signature
    'DepositFinalized(bytes32,uint256,address,uint256)': EventFragment; // Example signature, added amount
    'OwnershipTransferred(address,address)': EventFragment;
    'Paused(address)': EventFragment;
    'Unpaused(address)': EventFragment;
    // Potentially others like 'RoleAdminChanged', 'RoleGranted', 'RoleRevoked'
  };

  getEvent(nameOrSignatureOrTopic: string): EventFragment;
}

// --- Event Interfaces (for typed event access) ---

export interface StarkNetBitcoinDepositorInitializedEventObject {
  _starkGateBridge: string;
  _l2TbtcToken: string;
  _initialL1ToL2MessageFee: BigNumber;
}
export type StarkNetBitcoinDepositorInitializedEvent = TypedEvent<
  [string, string, BigNumber],
  StarkNetBitcoinDepositorInitializedEventObject
>;
export type StarkNetBitcoinDepositorInitializedEventFilter =
  TypedEventFilter<StarkNetBitcoinDepositorInitializedEvent>;

export interface DepositInitializedForStarkNetEventObject {
  depositKey: BytesLike;
  starkNetRecipient: BigNumber;
}
export type DepositInitializedForStarkNetEvent = TypedEvent<
  [BytesLike, BigNumber],
  DepositInitializedForStarkNetEventObject
>;
export type DepositInitializedForStarkNetEventFilter =
  TypedEventFilter<DepositInitializedForStarkNetEvent>;

export interface DepositBridgedToStarkNetEventObject {
  depositKey: BytesLike;
  starkNetRecipient: BigNumber;
  amount: BigNumber;
  messageNonce: BigNumber;
}
export type DepositBridgedToStarkNetEvent = TypedEvent<
  [BytesLike, BigNumber, BigNumber, BigNumber],
  DepositBridgedToStarkNetEventObject
>;
export type DepositBridgedToStarkNetEventFilter = TypedEventFilter<DepositBridgedToStarkNetEvent>;

export interface L1ToL2MessageFeeUpdatedEventObject {
  newFee: BigNumber;
}
export type L1ToL2MessageFeeUpdatedEvent = TypedEvent<
  [BigNumber],
  L1ToL2MessageFeeUpdatedEventObject
>;
export type L1ToL2MessageFeeUpdatedEventFilter = TypedEventFilter<L1ToL2MessageFeeUpdatedEvent>;

// Example Inherited Event - Adjust to match your actual AbstractL1BTCDepositor
export interface DepositInitializedEventObject {
  depositKey: BytesLike;
  fundingOutputIndex: BigNumber; // Example, ensure type matches ABI
  blindingFactor: BytesLike;
  walletPubKeyHash: BytesLike;
  refundPubKeyHash: BytesLike;
  refundLocktime: BigNumber;
  vault: string; // Assuming 'vault' is part of this event as per some conventions
}
export type DepositInitializedEvent = TypedEvent<
  [BytesLike, BigNumber, BytesLike, BytesLike, BytesLike, BigNumber, string],
  DepositInitializedEventObject
>;
export type DepositInitializedEventFilter = TypedEventFilter<DepositInitializedEvent>;

// Example Inherited Event - Adjust to match your actual AbstractL1BTCDepositor
export interface DepositFinalizedEventObject {
  depositKey: BytesLike;
  amountMinted: BigNumber;
  beneficiary: string;
  optimisticMintingFee: BigNumber; // Example, check actual event params
}
export type DepositFinalizedEvent = TypedEvent<
  [BytesLike, BigNumber, string, BigNumber],
  DepositFinalizedEventObject
>;
export type DepositFinalizedEventFilter = TypedEventFilter<DepositFinalizedEvent>;

export interface OwnershipTransferredEventObject {
  previousOwner: string;
  newOwner: string;
}
export type OwnershipTransferredEvent = TypedEvent<
  [string, string],
  OwnershipTransferredEventObject
>;
export type OwnershipTransferredEventFilter = TypedEventFilter<OwnershipTransferredEvent>;

export interface PausedEventObject {
  account: string;
}
export type PausedEvent = TypedEvent<[string], PausedEventObject>;
export type PausedEventFilter = TypedEventFilter<PausedEvent>;

export interface UnpausedEventObject {
  account: string;
}
export type UnpausedEvent = TypedEvent<[string], UnpausedEventObject>;
export type UnpausedEventFilter = TypedEventFilter<UnpausedEvent>;

// --- Main Contract Typed Instance ---

export interface EthersStarkNetBitcoinDepositor extends BaseContract {
  connect(signerOrProvider: Signer | Provider | string): this;
  attach(addressOrName: string): this;
  deployed(): Promise<this>;

  interface: EthersStarkNetBitcoinDepositorInterface;

  functions: {
    // From StarkNetBitcoinDepositor itself
    starkGateBridge(overrides?: CallOverrides): Promise<[string]>;
    l2TbtcToken(overrides?: CallOverrides): Promise<[string]>;
    l1ToL2MessageFee(overrides?: CallOverrides): Promise<[BigNumber]>;
    depositStarkNetRecipients(
      depositKey: BytesLike,
      overrides?: CallOverrides,
    ): Promise<[BigNumber]>;
    updateL1ToL2MessageFee(
      _newL1ToL2MessageFee: BigNumberish,
      overrides?: Overrides & { from?: string },
    ): Promise<ContractTransaction>;
    setDepositStateForTesting(
      depositKey: BigNumberish,
      state: BigNumberish,
      overrides?: Overrides & { from?: string },
    ): Promise<ContractTransaction>;
    emitDepositInitializedForStarkNet(
      _depositKey: BytesLike,
      _starkNetRecipient: BigNumberish,
      overrides?: Overrides & { from?: string },
    ): Promise<ContractTransaction>;

    // Overridden from AbstractL1BTCDepositor
    quoteFinalizeDeposit(overrides?: CallOverrides): Promise<[BigNumber] & { fee: BigNumber }>;

    // Inherited from AbstractL1BTCDepositor / AbstractBTCDepositor
    initializeDeposit(
      _fundingTx: FundingTransactionStruct, // This is how ethers.js expects struct parameters
      _reveal: [BytesLike, BytesLike, BytesLike, BytesLike, BytesLike], // Solidity: bytes[5]
      _depositOwner: BytesLike, // Solidity: bytes32 (extraData for StarkNet recipient)
      overrides?: PayableOverrides & { from?: string }, // It's payable in AbstractL1BTCDepositor
    ): Promise<ContractTransaction>;

    finalizeDeposit(
      depositKey: BytesLike, // Solidity: bytes32
      overrides?: PayableOverrides & { from?: string }, // It's payable due to msg.value requirement for _transferTbtc
    ): Promise<ContractTransaction>;

    tbtcToken(overrides?: CallOverrides): Promise<[string]>;
    tbtcVault(overrides?: CallOverrides): Promise<[string]>;
    bridge(overrides?: CallOverrides): Promise<[string]>;
    deposits(depositKey: BigNumberish, overrides?: CallOverrides): Promise<[number]>; // Assuming DepositState enum maps to uint8

    owner(overrides?: CallOverrides): Promise<[string]>;
    paused(overrides?: CallOverrides): Promise<[boolean]>;
    renounceOwnership(overrides?: Overrides & { from?: string }): Promise<ContractTransaction>;
    transferOwnership(
      newOwner: string,
      overrides?: Overrides & { from?: string },
    ): Promise<ContractTransaction>;
    pause(overrides?: Overrides & { from?: string }): Promise<ContractTransaction>;
    unpause(overrides?: Overrides & { from?: string }): Promise<ContractTransaction>;
  };

  // Direct-access functions (matching above for convenience)
  starkGateBridge(overrides?: CallOverrides): Promise<string>;
  l2TbtcToken(overrides?: CallOverrides): Promise<string>;
  l1ToL2MessageFee(overrides?: CallOverrides): Promise<BigNumber>;
  depositStarkNetRecipients(depositKey: BytesLike, overrides?: CallOverrides): Promise<BigNumber>;
  updateL1ToL2MessageFee(
    _newL1ToL2MessageFee: BigNumberish,
    overrides?: Overrides & { from?: string },
  ): Promise<ContractTransaction>;
  setDepositStateForTesting(
    depositKey: BigNumberish,
    state: BigNumberish,
    overrides?: Overrides & { from?: string },
  ): Promise<ContractTransaction>;
  emitDepositInitializedForStarkNet(
    _depositKey: BytesLike,
    _starkNetRecipient: BigNumberish,
    overrides?: Overrides & { from?: string },
  ): Promise<ContractTransaction>;

  quoteFinalizeDeposit(overrides?: CallOverrides): Promise<BigNumber>; // Simplified return for direct access

  initializeDeposit(
    _fundingTx: FundingTransactionStruct,
    _reveal: [BytesLike, BytesLike, BytesLike, BytesLike, BytesLike],
    _depositOwner: BytesLike,
    overrides?: PayableOverrides & { from?: string },
  ): Promise<ContractTransaction>;

  finalizeDeposit(
    depositKey: BytesLike,
    overrides?: PayableOverrides & { from?: string },
  ): Promise<ContractTransaction>;

  tbtcToken(overrides?: CallOverrides): Promise<string>;
  tbtcVault(overrides?: CallOverrides): Promise<string>;
  bridge(overrides?: CallOverrides): Promise<string>;
  deposits(depositKey: BigNumberish, overrides?: CallOverrides): Promise<number>; // Assuming DepositState enum maps to uint8

  owner(overrides?: CallOverrides): Promise<string>;
  paused(overrides?: CallOverrides): Promise<boolean>;
  renounceOwnership(overrides?: Overrides & { from?: string }): Promise<ContractTransaction>;
  transferOwnership(
    newOwner: string,
    overrides?: Overrides & { from?: string },
  ): Promise<ContractTransaction>;
  pause(overrides?: Overrides & { from?: string }): Promise<ContractTransaction>;
  unpause(overrides?: Overrides & { from?: string }): Promise<ContractTransaction>;

  // callStatic functions
  callStatic: {
    starkGateBridge(overrides?: CallOverrides): Promise<string>;
    l2TbtcToken(overrides?: CallOverrides): Promise<string>;
    l1ToL2MessageFee(overrides?: CallOverrides): Promise<BigNumber>;
    depositStarkNetRecipients(depositKey: BytesLike, overrides?: CallOverrides): Promise<BigNumber>;
    updateL1ToL2MessageFee(
      _newL1ToL2MessageFee: BigNumberish,
      overrides?: CallOverrides,
    ): Promise<void>;
    setDepositStateForTesting(
      depositKey: BigNumberish,
      state: BigNumberish,
      overrides?: CallOverrides,
    ): Promise<void>;
    emitDepositInitializedForStarkNet(
      _depositKey: BytesLike,
      _starkNetRecipient: BigNumberish,
      overrides?: CallOverrides,
    ): Promise<void>;

    quoteFinalizeDeposit(overrides?: CallOverrides): Promise<BigNumber>;

    initializeDeposit(
      _fundingTx: FundingTransactionStruct,
      _reveal: [BytesLike, BytesLike, BytesLike, BytesLike, BytesLike],
      _depositOwner: BytesLike,
      overrides?: CallOverrides, // PayableOverrides for callStatic might just be CallOverrides
    ): Promise<void>; // Or actual return type if any from callStatic

    finalizeDeposit(
      depositKey: BytesLike,
      overrides?: CallOverrides, // PayableOverrides for callStatic might just be CallOverrides
    ): Promise<void>; // Or actual return type if any from callStatic

    tbtcToken(overrides?: CallOverrides): Promise<string>;
    tbtcVault(overrides?: CallOverrides): Promise<string>;
    bridge(overrides?: CallOverrides): Promise<string>;
    deposits(depositKey: BigNumberish, overrides?: CallOverrides): Promise<number>; // Assuming DepositState enum maps to uint8

    owner(overrides?: CallOverrides): Promise<string>;
    paused(overrides?: CallOverrides): Promise<boolean>;
    renounceOwnership(overrides?: CallOverrides): Promise<void>;
    transferOwnership(newOwner: string, overrides?: CallOverrides): Promise<void>;
    pause(overrides?: CallOverrides): Promise<void>;
    unpause(overrides?: CallOverrides): Promise<void>;
  };

  // filters for events
  filters: {
    // From StarkNetBitcoinDepositor itself
    'StarkNetBitcoinDepositorInitialized(address,address,uint256)'(
      _starkGateBridge?: string | null,
      _l2TbtcToken?: string | null,
      _initialL1ToL2MessageFee?: null,
    ): StarkNetBitcoinDepositorInitializedEventFilter;
    StarkNetBitcoinDepositorInitialized(
      _starkGateBridge?: string | null,
      _l2TbtcToken?: string | null,
      _initialL1ToL2MessageFee?: null,
    ): StarkNetBitcoinDepositorInitializedEventFilter;

    'DepositInitializedForStarkNet(bytes32,uint256)'(
      depositKey?: BytesLike | null,
      starkNetRecipient?: BigNumberish | null,
    ): DepositInitializedForStarkNetEventFilter;
    DepositInitializedForStarkNet(
      depositKey?: BytesLike | null,
      starkNetRecipient?: BigNumberish | null,
    ): DepositInitializedForStarkNetEventFilter;

    'DepositBridgedToStarkNet(bytes32,uint256,uint256,uint256)'(
      depositKey?: BytesLike | null,
      starkNetRecipient?: BigNumberish | null,
      amount?: null,
      messageNonce?: null,
    ): DepositBridgedToStarkNetEventFilter;
    DepositBridgedToStarkNet(
      depositKey?: BytesLike | null,
      starkNetRecipient?: BigNumberish | null,
      amount?: null,
      messageNonce?: null,
    ): DepositBridgedToStarkNetEventFilter;

    'L1ToL2MessageFeeUpdated(uint256)'(newFee?: null): L1ToL2MessageFeeUpdatedEventFilter;
    L1ToL2MessageFeeUpdated(newFee?: null): L1ToL2MessageFeeUpdatedEventFilter;

    // Inherited Events - Ensure these match your actual parent contract events
    'DepositInitialized(bytes32,uint256,bytes,bytes,bytes32,uint256,address)'(
      depositKey?: BytesLike | null,
      fundingOutputIndex?: null, // Adjust if indexed
      blindingFactor?: null,
      walletPubKeyHash?: null,
      refundPubKeyHash?: null,
      refundLocktime?: null,
      vault?: string | null,
    ): DepositInitializedEventFilter;
    DepositInitialized(
      depositKey?: BytesLike | null,
      fundingOutputIndex?: null,
      blindingFactor?: null,
      walletPubKeyHash?: null,
      refundPubKeyHash?: null,
      refundLocktime?: null,
      vault?: string | null,
    ): DepositInitializedEventFilter;

    'DepositFinalized(bytes32,uint256,address,uint256)'(
      depositKey?: BytesLike | null,
      amountMinted?: null,
      beneficiary?: string | null,
      optimisticMintingFee?: null,
    ): DepositFinalizedEventFilter;
    DepositFinalized(
      depositKey?: BytesLike | null,
      amountMinted?: null,
      beneficiary?: string | null,
      optimisticMintingFee?: null,
    ): DepositFinalizedEventFilter;

    'OwnershipTransferred(address,address)'(
      previousOwner?: string | null,
      newOwner?: string | null,
    ): OwnershipTransferredEventFilter;
    OwnershipTransferred(
      previousOwner?: string | null,
      newOwner?: string | null,
    ): OwnershipTransferredEventFilter;

    'Paused(address)'(account?: string | null): PausedEventFilter;
    Paused(account?: string | null): PausedEventFilter;

    'Unpaused(address)'(account?: string | null): UnpausedEventFilter;
    Unpaused(account?: string | null): UnpausedEventFilter;
  };

  // estimateGas functions
  estimateGas: {
    starkGateBridge(overrides?: CallOverrides): Promise<BigNumber>;
    l2TbtcToken(overrides?: CallOverrides): Promise<BigNumber>;
    l1ToL2MessageFee(overrides?: CallOverrides): Promise<BigNumber>;
    depositStarkNetRecipients(depositKey: BytesLike, overrides?: CallOverrides): Promise<BigNumber>;
    updateL1ToL2MessageFee(
      _newL1ToL2MessageFee: BigNumberish,
      overrides?: Overrides & { from?: string },
    ): Promise<BigNumber>;
    setDepositStateForTesting(
      depositKey: BigNumberish,
      state: BigNumberish,
      overrides?: Overrides & { from?: string },
    ): Promise<BigNumber>;
    emitDepositInitializedForStarkNet(
      _depositKey: BytesLike,
      _starkNetRecipient: BigNumberish,
      overrides?: Overrides & { from?: string },
    ): Promise<BigNumber>;

    quoteFinalizeDeposit(overrides?: CallOverrides): Promise<BigNumber>;

    initializeDeposit(
      _fundingTx: FundingTransactionStruct,
      _reveal: [BytesLike, BytesLike, BytesLike, BytesLike, BytesLike],
      _depositOwner: BytesLike,
      overrides?: PayableOverrides & { from?: string },
    ): Promise<BigNumber>;

    finalizeDeposit(
      depositKey: BytesLike,
      overrides?: PayableOverrides & { from?: string },
    ): Promise<BigNumber>;

    tbtcToken(overrides?: CallOverrides): Promise<BigNumber>;
    tbtcVault(overrides?: CallOverrides): Promise<BigNumber>;
    bridge(overrides?: CallOverrides): Promise<BigNumber>;
    deposits(depositKey: BigNumberish, overrides?: CallOverrides): Promise<BigNumber>;

    owner(overrides?: CallOverrides): Promise<BigNumber>;
    paused(overrides?: CallOverrides): Promise<BigNumber>;
    renounceOwnership(overrides?: Overrides & { from?: string }): Promise<BigNumber>;
    transferOwnership(
      newOwner: string,
      overrides?: Overrides & { from?: string },
    ): Promise<BigNumber>;
    pause(overrides?: Overrides & { from?: string }): Promise<BigNumber>;
    unpause(overrides?: Overrides & { from?: string }): Promise<BigNumber>;
  };

  // populateTransaction functions
  populateTransaction: {
    starkGateBridge(overrides?: CallOverrides): Promise<PopulatedTransaction>;
    l2TbtcToken(overrides?: CallOverrides): Promise<PopulatedTransaction>;
    l1ToL2MessageFee(overrides?: CallOverrides): Promise<PopulatedTransaction>;
    depositStarkNetRecipients(
      depositKey: BytesLike,
      overrides?: CallOverrides,
    ): Promise<PopulatedTransaction>;
    updateL1ToL2MessageFee(
      _newL1ToL2MessageFee: BigNumberish,
      overrides?: Overrides & { from?: string },
    ): Promise<PopulatedTransaction>;
    setDepositStateForTesting(
      depositKey: BigNumberish,
      state: BigNumberish,
      overrides?: Overrides & { from?: string },
    ): Promise<PopulatedTransaction>;
    emitDepositInitializedForStarkNet(
      _depositKey: BytesLike,
      _starkNetRecipient: BigNumberish,
      overrides?: Overrides & { from?: string },
    ): Promise<PopulatedTransaction>;

    quoteFinalizeDeposit(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    initializeDeposit(
      _fundingTx: FundingTransactionStruct,
      _reveal: [BytesLike, BytesLike, BytesLike, BytesLike, BytesLike],
      _depositOwner: BytesLike,
      overrides?: PayableOverrides & { from?: string },
    ): Promise<PopulatedTransaction>;

    finalizeDeposit(
      depositKey: BytesLike,
      overrides?: PayableOverrides & { from?: string },
    ): Promise<PopulatedTransaction>;

    tbtcToken(overrides?: CallOverrides): Promise<PopulatedTransaction>;
    tbtcVault(overrides?: CallOverrides): Promise<PopulatedTransaction>;
    bridge(overrides?: CallOverrides): Promise<PopulatedTransaction>;
    deposits(depositKey: BigNumberish, overrides?: CallOverrides): Promise<PopulatedTransaction>;

    owner(overrides?: CallOverrides): Promise<PopulatedTransaction>;
    paused(overrides?: CallOverrides): Promise<PopulatedTransaction>;
    renounceOwnership(overrides?: Overrides & { from?: string }): Promise<PopulatedTransaction>;
    transferOwnership(
      newOwner: string,
      overrides?: Overrides & { from?: string },
    ): Promise<PopulatedTransaction>;
    pause(overrides?: Overrides & { from?: string }): Promise<PopulatedTransaction>;
    unpause(overrides?: Overrides & { from?: string }): Promise<PopulatedTransaction>;
  };
}
