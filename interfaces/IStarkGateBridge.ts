import type {
  BigNumberish,
  BytesLike,
  EventFilter,
  Overrides,
  PayableOverrides,
  CallOverrides,
  ContractTransaction,
  Signer,
  ContractFunction,
} from 'ethers';
import { ethers } from 'ethers';
import type { Listener, Provider } from '@ethersproject/abstract-provider';

// This interface defines the methods and events of the StarkGate Bridge contract
// that our relayer will interact with, based on the updated contracts/cross-chain/starknet/interfaces/IStarkGateBridge.sol
// It explicitly *does not* extend ethers.Contract, allowing for simpler mocks.
export interface IStarkGateBridge {
  /**
   * deposit(address token, uint256 amount, uint256 l2Recipient) payable returns (uint256)
   */
  deposit(
    token: string,
    amount: BigNumberish,
    l2Recipient: BigNumberish,
    overrides?: PayableOverrides,
  ): Promise<ContractTransaction>;

  /**
   * depositWithMessage(address token, uint256 amount, uint256 l2Recipient, uint256[] message) payable returns (uint256)
   */
  depositWithMessage(
    token: string,
    amount: BigNumberish,
    l2Recipient: BigNumberish,
    message: BigNumberish[],
    overrides?: PayableOverrides,
  ): Promise<ContractTransaction>;

  /**
   * estimateMessageFee() view returns (uint256)
   */
  estimateMessageFee(overrides?: CallOverrides): Promise<BigNumberish>;

  /**
   * depositWithMessageCancelRequest(address token, uint256 amount, uint256 l2Recipient, uint256[] message, uint256 nonce)
   */
  depositWithMessageCancelRequest(
    token: string,
    amount: BigNumberish,
    l2Recipient: BigNumberish,
    message: BigNumberish[],
    nonce: BigNumberish,
    overrides?: Overrides,
  ): Promise<ContractTransaction>;

  /**
   * l1ToL2MessageNonce() view returns (uint256)
   */
  l1ToL2MessageNonce(overrides?: CallOverrides): Promise<BigNumberish>;

  /**
   * isDepositCancellable(uint256 nonce) view returns (bool)
   */
  isDepositCancellable(nonce: BigNumberish, overrides?: CallOverrides): Promise<boolean>;

  // StarkNetBitcoinDepositor contract functions that might still be called via this interface
  
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
  finalizeDeposit(depositKey: BytesLike, overrides?: PayableOverrides): Promise<ContractTransaction>;

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
      starkNetRecipient?: BigNumberish | null,
      amount?: null,
      messageNonce?: null,
    ): EventFilter;
  };

  // Event listener methods that our application might use directly on the contract instance
  on(
    event: 'TBTCBridgedToStarkNet',
    listener: (
      depositKey: string,
      starkNetRecipient: BigNumberish,
      amount: BigNumberish,
      messageNonce: BigNumberish,
      event: any,
    ) => void,
  ): this;
  on(event: EventFilter | string, listener: Listener): this;

  once(
    event: 'TBTCBridgedToStarkNet',
    listener: (
      depositKey: string,
      starkNetRecipient: BigNumberish,
      amount: BigNumberish,
      messageNonce: BigNumberish,
      event: any,
    ) => void,
  ): this;
  once(event: EventFilter | string, listener: Listener): this;

  off(
    event: 'TBTCBridgedToStarkNet',
    listener: (
      depositKey: string,
      starkNetRecipient: BigNumberish,
      amount: BigNumberish,
      messageNonce: BigNumberish,
      event: any,
    ) => void,
  ): this;
  off(event: EventFilter | string, listener: Listener): this;

  removeAllListeners(event?: EventFilter | string): this;
  listeners(event?: EventFilter | string): Array<Listener>;
  listenerCount(event?: EventFilter | string): number;

  // Contract properties
  readonly address: string;
  readonly interface: ethers.utils.Interface;
  readonly signer: Signer | null;
  readonly provider: Provider | null;
  readonly callStatic: { [key: string]: ContractFunction };
  readonly estimateGas: { [key: string]: ContractFunction };
  readonly populateTransaction: { [key: string]: ContractFunction };
  readonly resolvedAddress: Promise<string>;
  readonly functions: { [key: string]: ContractFunction };
  readonly deployed: () => Promise<ethers.Contract>;
  readonly deployTransaction: ContractTransaction | undefined;
}

// This type represents the *actual* ethers.Contract instance at runtime,
// which will also satisfy our application-specific interface.
export type EthersStarkGateBridge = ethers.Contract & IStarkGateBridge;
