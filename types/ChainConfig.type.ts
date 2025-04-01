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

  /** Private key for signing transactions */
  privateKey: string;

  /** Whether to use an HTTP endpoint instead of an L2 contract */
  useEndpoint: boolean;

  /** URL for the HTTP endpoint (if useEndpoint is true) */
  endpointUrl?: string;

  /** Starting block number for scanning L2 events */
  l2StartBlock?: number;
}
