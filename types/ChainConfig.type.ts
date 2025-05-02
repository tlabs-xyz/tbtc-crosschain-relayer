/**
 * Enum defining different supported chain types
 */
export enum ChainType {
  EVM = 'evm',
  STARKNET = 'starknet',
  SUI = 'sui',
  SOLANA = 'solana',
}

/**
 * Interface for chain configuration
 */
export interface ChainConfig {
  /** Type of blockchain */
  chainType: ChainType;

  /** Name of the chain for logging and identification */
  chainName: string;

  /** RPC URL for the Layer 1 chain (typically Ethereum) */
  l1Rpc: string;

  /** RPC URL for the Layer 2 chain */
  l2Rpc: string;

  /** Address of the L1BitcoinDepositor contract */
  l1ContractAddress: string;

  /** Address of the L2BitcoinDepositor contract */
  l2ContractAddress: string;

  /** Address of the TBTCVault contract */
  vaultAddress: string;

  /** Private key for signing transactions on L1 */
  privateKey: string;

  /** Private key for signing transactions on L2 (specifically for Sui) */
  l2PrivateKey?: string;

  /** Whether to use an HTTP endpoint instead of an L2 contract */
  useEndpoint: boolean;

  /** URL for the HTTP endpoint (if useEndpoint is true) */
  endpointUrl?: string;

  /** Starting block number for scanning L2 events */
  l2StartBlock?: number;

  // Sui-specific object IDs
  /** ID of the BitcoinDepositor ReceiverState object (Sui) */
  receiverStateId?: string;

  /** ID of the Gateway State object (Sui) */
  gatewayStateId?: string;

  /** ID of the Gateway Capabilities object (Sui) */
  gatewayCapabilitiesId?: string;

  /** ID of the Gateway Wrapped Token Treasury object (Sui) */
  treasuryId?: string;

  /** ID of the Wormhole State object (Sui) */
  wormholeStateId?: string;

  /** ID of the Token Bridge State object (Sui) */
  tokenBridgeStateId?: string;

  /** ID of the TBTC Token State object (Sui) */
  tbtcTokenStateId?: string;
}
