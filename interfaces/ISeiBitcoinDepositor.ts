import type { ethers } from 'ethers';
import type { SeiBitcoinDepositorABI } from './SeiBitcoinDepositor.js';

export type SeiBitcoinDepositor = ethers.Contract & {
  interface: ethers.utils.Interface;
  
  // Read functions
  deposits(depositKey: ethers.BigNumberish): Promise<number>;
  bridge(): Promise<string>;
  tbtcVault(): Promise<string>;
  tbtcToken(): Promise<string>;
  nttManager(): Promise<string>;
  wormholeChainId(): Promise<number>;
  
  // Write functions
  initializeDeposit(
    fundingTx: any,
    reveal: any,
    destinationChainDepositOwner: string,
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
      destinationChainDepositOwner?: string | null,
      l1Sender?: string | null,
    ): ethers.EventFilter;
    
    DepositFinalized(
      depositKey?: ethers.BigNumberish | null,
      destinationChainDepositOwner?: string | null,
      l1Sender?: string | null,
    ): ethers.EventFilter;
    
    TBTCBridgedViaNTT(
      depositKey?: ethers.BytesLike | null,
      recipient?: string | null,
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
    eventName: 'TBTCBridgedViaNTT',
    listener: (
      depositKey: string,
      recipient: string,
      amount: ethers.BigNumber,
      sequence: ethers.BigNumber,
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
      destinationChainDepositOwner: string,
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
      destinationChainDepositOwner: string,
      overrides?: ethers.PayableOverrides,
    ): Promise<ethers.BigNumber>;
    
    finalizeDeposit(
      depositKey: ethers.BigNumberish,
      overrides?: ethers.PayableOverrides,
    ): Promise<ethers.BigNumber>;
  };
};

