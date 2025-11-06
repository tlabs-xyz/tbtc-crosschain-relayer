import type { ethers } from 'ethers';
import type { SeiBitcoinDepositorABI } from './SeiBitcoinDepositor.js';

/**
 * Sei Bitcoin Depositor Interface - Updated for SDK v2
 * This interface matches the L1BTCDepositorNttWithExecutor contract
 * with NTT Hub & Spoke pattern and Wormhole Executor support.
 * 
 * Key Updates:
 * - destinationChainDepositOwner is now bytes32 (not address)
 * - Added new workflow and executor management functions
 * - Added TokensTransferredNttWithExecutor event
 */
export type SeiBitcoinDepositor = ethers.Contract & {
  interface: ethers.utils.Interface;
  
  // Read functions
  deposits(depositKey: ethers.BigNumberish): Promise<number>;
  bridge(): Promise<string>;
  tbtcVault(): Promise<string>;
  tbtcToken(): Promise<string>;
  nttManagerWithExecutor(): Promise<string>;
  underlyingNttManager(): Promise<string>;
  defaultSupportedChain(): Promise<number>;
  supportedChains(chainId: number): Promise<boolean>;
  parameterExpirationTime(): Promise<ethers.BigNumber>;
  
  // Workflow management functions
  canUserStartNewWorkflow(user: string): Promise<boolean>;
  getUserWorkflowInfo(user: string): Promise<{
    hasActiveWorkflow: boolean;
    nonce: string;
    timestamp: ethers.BigNumber;
    timeRemaining: ethers.BigNumber;
  }>;
  getUserWorkflowStatus(user: string): Promise<{
    hasActiveWorkflow: boolean;
    nonce: string;
    timestamp: ethers.BigNumber;
  }>;
  areExecutorParametersSet(): Promise<{ isSet: boolean; nonce: string }>;
  getStoredExecutorValue(): Promise<ethers.BigNumber>;
  
  // Quote functions
  quoteFinalizeDeposit(destinationChain?: number): Promise<ethers.BigNumber>;
  quoteFinalizedDeposit(destinationChain: number): Promise<{
    nttDeliveryPrice: ethers.BigNumber;
    executorCost: ethers.BigNumber;
    totalCost: ethers.BigNumber;
  }>;
  
  // Write functions
  initializeDeposit(
    fundingTx: any,
    reveal: any,
    destinationChainDepositOwner: ethers.BytesLike,
    overrides?: ethers.PayableOverrides,
  ): Promise<ethers.ContractTransaction>;
  
  finalizeDeposit(
    depositKey: ethers.BigNumberish,
    overrides?: ethers.PayableOverrides,
  ): Promise<ethers.ContractTransaction>;
  
  // Event filters
  filters: {
    DepositInitialized(
      depositKey?: ethers.BigNumberish | null,
      destinationChainDepositOwner?: ethers.BytesLike | null,
      l1Sender?: string | null,
    ): ethers.EventFilter;
    
    DepositFinalized(
      depositKey?: ethers.BigNumberish | null,
      destinationChainDepositOwner?: ethers.BytesLike | null,
      l1Sender?: string | null,
    ): ethers.EventFilter;
    
    TokensTransferredNttWithExecutor(
      sender?: string | null,
      nonce?: ethers.BytesLike | null,
    ): ethers.EventFilter;
  };
  
  // Event listening
  on(
    eventName: 'DepositInitialized',
    listener: (
      depositKey: ethers.BigNumber,
      destinationChainDepositOwner: string,
      l1Sender: string,
      event: ethers.Event,
    ) => void,
  ): SeiBitcoinDepositor;
  
  on(
    eventName: 'DepositFinalized',
    listener: (
      depositKey: ethers.BigNumber,
      destinationChainDepositOwner: string,
      l1Sender: string,
      initialAmount: ethers.BigNumber,
      tbtcAmount: ethers.BigNumber,
      event: ethers.Event,
    ) => void,
  ): SeiBitcoinDepositor;
  
  on(
    eventName: 'TokensTransferredNttWithExecutor',
    listener: (
      sender: string,
      nonce: string,
      amount: ethers.BigNumber,
      destinationChain: number,
      actualRecipient: string,
      transferSequence: ethers.BigNumber,
      encodedReceiver: string,
      executorCost: ethers.BigNumber,
      event: ethers.Event,
    ) => void,
  ): SeiBitcoinDepositor;
  
  // Query filters
  queryFilter(
    event: ethers.EventFilter,
    fromBlock?: number,
    toBlock?: number,
  ): Promise<ethers.Event[]>;
  
  // Static call for simulation
  callStatic: {
    initializeDeposit(
      fundingTx: any,
      reveal: any,
      destinationChainDepositOwner: ethers.BytesLike,
      overrides?: ethers.CallOverrides,
    ): Promise<void>;
    
    finalizeDeposit(
      depositKey: ethers.BigNumberish,
      overrides?: ethers.CallOverrides,
    ): Promise<void>;
  };
  
  // Gas estimation
  estimateGas: {
    initializeDeposit(
      fundingTx: any,
      reveal: any,
      destinationChainDepositOwner: ethers.BytesLike,
      overrides?: ethers.PayableOverrides,
    ): Promise<ethers.BigNumber>;
    
    finalizeDeposit(
      depositKey: ethers.BigNumberish,
      overrides?: ethers.PayableOverrides,
    ): Promise<ethers.BigNumber>;
  };
};

