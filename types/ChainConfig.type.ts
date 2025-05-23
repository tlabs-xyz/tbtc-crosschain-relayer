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

  /**
   * Optional address of the L2BitcoinRedeemer contract/program.
   * Not all chains will have L2 redemption functionality, or it may be deployed
   * later than minting. Non-EVM chains, for example, might initially lack a
   * specific L2BitcoinRedeemer program while still supporting tBTC minting.
   */
  l2BitcoinRedeemerAddress?: string;

  /** Address of the L2WormholeGateway contract */
  l2WormholeGatewayAddress: string;

  /** Wormhole Chain ID for the L2 network */
  l2WormholeChainId: number;

  /** Address of the TBTCVault contract */
  vaultAddress?: string;

  /** Private key for signing transactions */
  privateKey: string;

  /**
   * Determines if the relayer should use HTTP endpoints for deposit processing
   * instead of direct L2 event listeners.
   * When true, L2 listeners are disabled, and routes like /api/:chainName/reveal
   * and /api/:chainName/deposit/:depositId become available.
   * Defaults to false.
   */
  useEndpoint?: boolean;

  /** Address of the L2BitcoinDepositor contract */
  l2ContractAddress?: string;

  /** URL for the HTTP endpoint (if useEndpoint is true) */
  endpointUrl?: string;

  /** Starting block number for scanning L2 events */
  l2StartBlock?: number;

  /** Private key for Solana */
  solanaPrivateKey?: string;

  /** Base64 encoded secret key for Solana */
  solanaSignerKeyBase?: string;

  /**
   * When `useEndpoint` is true, this flag specifically controls whether the
   * POST /api/:chainName/reveal endpoint is active for this chain.
   * If `useEndpoint` is true but this is false, the reveal endpoint will return a 405 error.
   * This allows enabling the general endpoint mode while selectively disabling the reveal intake.
   * Defaults to false.
   */
  supportsRevealDepositAPI?: boolean;

  /** Solana commitment level for transactions */
  solanaCommitment?: 'processed' | 'confirmed' | 'finalized';
};
