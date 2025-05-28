import type {
  BigNumberish,
  BytesLike,
  EventFilter,
  Overrides,
  CallOverrides,
  ContractTransaction,
  Signer,
  ContractFunction,
} from 'ethers';
import { ethers } from 'ethers';
import type { Listener, Provider } from '@ethersproject/abstract-provider';

// This interface defines the *application-specific* methods and events
// of the StarkGate Bridge contract that our relayer will interact with.
// It explicitly *does not* extend ethers.Contract, allowing for simpler mocks.
export interface IStarkGateBridge {
  /**
   * initializeDeposit(bytes fundingTx, bytes reveal, bytes32 l2DepositOwner)
   */
  initializeDeposit(
    fundingTx: BytesLike,
    reveal: BytesLike,
    l2DepositOwner: BytesLike,
    overrides?: Overrides,
  ): Promise<ContractTransaction>;

  /**
   * finalizeDeposit(bytes32 depositKey) payable
   */
  finalizeDeposit(depositKey: BytesLike, overrides?: Overrides): Promise<ContractTransaction>;

  /**
   * quoteFinalizeDeposit() view returns (uint256)
   */
  quoteFinalizeDeposit(overrides?: CallOverrides): Promise<BigNumberish>;

  /**
   * l1ToL2MessageFee() view returns (uint256)
   */
  l1ToL2MessageFee(overrides?: CallOverrides): Promise<BigNumberish>;

  /**
   * updateL1ToL2MessageFee(uint256 newFee) onlyOwner
   */
  updateL1ToL2MessageFee(newFee: BigNumberish, overrides?: Overrides): Promise<ContractTransaction>;

  // Event filters specific to our application's needs
  filters: {
    TBTCBridgedToStarkNet(
      depositKey?: BytesLike | null,
      amount?: null, // Event filter doesn't filter on non-indexed params
      starkNetRecipient?: null, // Event filter doesn't filter on non-indexed params
    ): EventFilter;
  };

  // Event listener methods that our application might use directly on the contract instance
  // These are often part of ethers.Contract, but we'll include minimal definitions here
  // as our code will likely call them.
  on(
    event: 'TBTCBridgedToStarkNet',
    listener: (
      depositKey: string,
      amount: BigNumberish,
      starkNetRecipient: string,
      event: any,
    ) => void,
  ): this;
  on(event: EventFilter | string, listener: Listener): this; // Use imported Listener

  once(
    event: 'TBTCBridgedToStarkNet',
    listener: (
      depositKey: string,
      amount: BigNumberish,
      starkNetRecipient: string,
      event: any,
    ) => void,
  ): this;
  once(event: EventFilter | string, listener: Listener): this;

  off(
    event: 'TBTCBridgedToStarkNet',
    listener: (
      depositKey: string,
      amount: BigNumberish,
      starkNetRecipient: string,
      event: any,
    ) => void,
  ): this;
  off(event: EventFilter | string, listener: Listener): this;

  removeAllListeners(event?: EventFilter | string): this;
  listeners(event?: EventFilter | string): Array<Listener>; // Use imported Listener
  listenerCount(event?: EventFilter | string): number;

  // We explicitly add the 'address' and 'interface' properties as they are commonly accessed
  // from an ethers.Contract instance and are relevant for contract interaction.
  readonly address: string;
  readonly interface: ethers.utils.Interface;

  // The 'signer' and 'provider' are typically accessed from an ethers.Contract,
  // so we include them here, but make them nullable as they might not always be present
  // on a contract instance (e.g., if it's connected to a provider only).
  readonly signer: Signer | null;
  readonly provider: Provider | null; // Use imported Provider

  // These properties are part of the ethers.Contract interface that IStarkGateBridge combines with.
  // We need to define them here to satisfy the `ethers.Contract & IStarkGateBridge` type.
  readonly callStatic: { [key: string]: ContractFunction };
  readonly estimateGas: { [key: string]: ContractFunction };
  readonly populateTransaction: { [key: string]: ContractFunction };
  readonly resolvedAddress: Promise<string>;
  readonly functions: { [key: string]: ContractFunction };

  // For `deployed()` and `deployTransaction`, we need to match the ethers.Contract type precisely.
  // The `deployed()` method on Contract returns `Promise<Contract>`, so our mock also needs to.
  readonly deployed: () => Promise<ethers.Contract>;
  readonly deployTransaction: ContractTransaction | undefined;
}

// This type represents the *actual* ethers.Contract instance at runtime,
// which will also satisfy our application-specific interface.
// When you create an ethers.Contract object (e.g., `new ethers.Contract(address, abi, signerOrProvider)`),
// it will satisfy this combined type if its ABI matches `IStarkGateBridge`.
export type EthersStarkGateBridge = ethers.Contract & IStarkGateBridge;
