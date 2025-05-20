export enum NETWORK {
  MAINNET = 'Mainnet',
  TESTNET = 'Testnet',
  DEVNET = 'Devnet',
}

/**
 * Enum defining different supported chain types
 */
export enum CHAIN_TYPE {
  EVM = 'Evm',
  STARKNET = 'Starknet',
  SUI = 'Sui',
  SOLANA = 'Solana',
}

export enum CHAIN_NAME {
  SEPOLIA = 'Sepolia',
  ETHEREUM = 'Ethereum',
  ARBITRUM = 'Arbitrum',
  ARBITRUM_SEPOLIA = 'ArbitrumSepolia',
  BASE = 'Base',
  BASE_SEPOLIA = 'BaseSepolia',
  SOLANA = 'Solana',
  SUI = 'Sui',
  STARKNET = 'Starknet',
}

/**
 * Interface for chain configuration
 */
export type ChainConfig = {
  /** Type of blockchain */
  chainType: CHAIN_TYPE;

  /** Network type (e.g., Mainnet, Testnet, Devnet) */
  network: NETWORK;

  /** Name of the chain for logging and identification */
  chainName: string;

  /** RPC URL for the Layer 1 chain (typically Ethereum) */
  l1Rpc: string;

  /** RPC URL for the Layer 2 chain */
  l2Rpc: string;

  /** WebSocket RPC endpoint for the Layer 2 chain */
  l2WsRpc?: string;

  /** Address of the L1BitcoinDepositor contract */
  l1ContractAddress: string;

  /** Address of the L1BitcoinRedeemer contract */
  l1BitcoinRedeemerAddress: string;

  /** Address of the L2BitcoinRedeemer contract */
  l2BitcoinRedeemerAddress: string;

  /** Address of the L2WormholeGateway contract */
  l2WormholeGatewayAddress: string;

  /** Wormhole Chain ID for the L2 network */
  l2WormholeChainId: number;

  /** Address of the TBTCVault contract */
  vaultAddress?: string;

  /** Private key for signing transactions */
  privateKey: string;

  /** Whether to use an HTTP endpoint instead of an L2 contract */
  useEndpoint?: boolean;

  /** Address of the L2BitcoinDepositor contract */
  l2ContractAddress?: string;

  /** URL for the HTTP endpoint (if useEndpoint is true) */
  endpointUrl?: string;

  /** Starting block number for scanning L2 events */
  l2StartBlock?: number;

  solanaPrivateKey?: string;

  solanaCommitment?: 'processed' | 'confirmed' | 'finalized';

  solanaSignerKeyBase?: string;
};
