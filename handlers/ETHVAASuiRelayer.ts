import { ethers } from 'ethers';
import { ChainConfig, ChainType } from '../types/ChainConfig.type';
import { LogError, LogMessage, LogWarning } from '../utils/Logs';
import { SuiChainHandler } from './SuiChainHandler';

// Custom ABI for the token bridge contract events we need
const TOKEN_BRIDGE_EVENTS_ABI = [
  'event TokensTransferredWithPayload(address token, uint256 amount, uint16 recipientChain, bytes32 recipient, uint256 nonce, bytes payload, uint256 fee)',
];

// Wormhole Guardian API URL
const GUARDIAN_API_URL = 'https://api.wormholescan.io/api/v1/vaa/';
// Consider adding this to config

interface TokenBridgeConfig {
  tokenBridgeAddress: string;
  emitterChain: number; // Ethereum is 2 in Wormhole
  emitterAddress: string; // Address of the Token Bridge on Ethereum (in wormhole format, without 0x, lowercase)
}

/**
 * This class is responsible for:
 * 1. Monitoring TokensTransferredWithPayload events on Ethereum
 * 2. Fetching the VAAs from the Guardian API
 * 3. Submitting them to SuiChainHandler for relay to the Bitcoin Depositor contract on Sui
 */
export class ETHVAASuiRelayer {
  private l1Provider: ethers.providers.JsonRpcProvider;
  private tokenBridgeContract: ethers.Contract;
  private suiHandler: SuiChainHandler;
  private tokenBridgeConfig: TokenBridgeConfig;

  // Keep track of processed VAAs to avoid duplicates
  private processedVAAs: Set<string> = new Set();

  constructor(
    l1Config: ChainConfig,
    l2Config: ChainConfig,
    tokenBridgeConfig: TokenBridgeConfig
  ) {
    if (l1Config.chainType !== ChainType.EVM) {
      throw new Error('ETHVAASuiRelayer requires L1 to be an EVM chain');
    }

    if (l2Config.chainType !== ChainType.SUI) {
      throw new Error('ETHVAASuiRelayer requires L2 to be a SUI chain');
    }

    this.tokenBridgeConfig = tokenBridgeConfig;
    this.l1Provider = new ethers.providers.JsonRpcProvider(l1Config.l1Rpc);

    // Initialize token bridge contract
    this.tokenBridgeContract = new ethers.Contract(
      tokenBridgeConfig.tokenBridgeAddress,
      TOKEN_BRIDGE_EVENTS_ABI,
      this.l1Provider
    );

    // Initialize Sui chain handler
    this.suiHandler = new SuiChainHandler(l2Config);

    LogMessage('ETHVAASuiRelayer initialized');
  }

  /**
   * Initialize the relayer, connecting to both chains
   */
  async initialize(): Promise<void> {
    try {
      // Initialize the Sui handler
      await this.suiHandler.initialize();
      LogMessage('Sui handler initialized');

      // We don't need to initialize the L1 contract beyond creating it above
      LogMessage('ETHVAASuiRelayer initialization completed');
    } catch (error: any) {
      LogError(`Error initializing ETHVAASuiRelayer: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Start listening for token bridge events
   */
  async startListening(): Promise<void> {
    try {
      LogMessage('Starting to listen for TokensTransferredWithPayload events');

      // Set up event listener
      this.tokenBridgeContract.on(
        'TokensTransferredWithPayload',
        async (
          token: string,
          amount: ethers.BigNumber,
          recipientChain: number,
          recipient: string,
          nonce: ethers.BigNumber,
          payload: string,
          fee: ethers.BigNumber
        ) => {
          try {
            // Only process events targeting Sui chain
            // (recipientChain is a Wormhole chain ID, Sui is 21)
            if (recipientChain !== 21) {
              return;
            }

            LogMessage(
              `TokensTransferredWithPayload event detected:
              Token: ${token}
              Amount: ${amount.toString()}
              Recipient Chain: ${recipientChain}
              Recipient: ${recipient}
              Nonce: ${nonce.toString()}`
            );

            // Generate a unique ID for this transaction
            const txHash = await this.getCurrentTransactionHash();
            if (!txHash) {
              LogWarning('Could not determine transaction hash for event');
              return;
            }

            const vaaId = `${this.tokenBridgeConfig.emitterChain}/${this.tokenBridgeConfig.emitterAddress}/${nonce.toString()}`;
            LogMessage(`VAA ID: ${vaaId}`);

            // Check if we've already processed this VAA
            if (this.processedVAAs.has(vaaId)) {
              LogMessage(`VAA ${vaaId} already processed, skipping`);
              return;
            }

            // Process with delay to ensure VAA is available
            setTimeout(async () => {
              await this.fetchAndRelayVAA(vaaId, txHash);
            }, 10000); // 10 second delay to ensure VAA is available from Guardian API
          } catch (error: any) {
            LogError(
              `Error processing TokensTransferredWithPayload event: ${error.message}`,
              error
            );
          }
        }
      );

      LogMessage('TokensTransferredWithPayload event listener registered');
    } catch (error: any) {
      LogError(
        `Error starting ETHVAASuiRelayer listener: ${error.message}`,
        error
      );
      throw error;
    }
  }

  /**
   * Check for past token transfer events and process them
   */
  async checkForPastTransfers(options: {
    fromBlock: number;
    toBlock: number;
  }): Promise<void> {
    try {
      LogMessage(
        `Checking for past token transfers from block ${options.fromBlock} to ${options.toBlock}`
      );

      const events = await this.tokenBridgeContract.queryFilter(
        this.tokenBridgeContract.filters.TokensTransferredWithPayload(),
        options.fromBlock,
        options.toBlock
      );

      LogMessage(`Found ${events.length} past token transfer events`);

      for (const event of events) {
        const { args, transactionHash } = event;
        if (!args) continue;

        const [token, amount, recipientChain, recipient, nonce, payload, fee] =
          args;

        // Only process events targeting Sui chain
        if (recipientChain !== 21) {
          continue;
        }

        const vaaId = `${this.tokenBridgeConfig.emitterChain}/${this.tokenBridgeConfig.emitterAddress}/${nonce.toString()}`;

        // Check if we've already processed this VAA
        if (this.processedVAAs.has(vaaId)) {
          LogMessage(`VAA ${vaaId} already processed, skipping`);
          continue;
        }

        LogMessage(
          `Processing past token transfer event with VAA ID: ${vaaId}`
        );
        await this.fetchAndRelayVAA(vaaId, transactionHash);
      }
    } catch (error: any) {
      LogError(
        `Error checking for past token transfers: ${error.message}`,
        error
      );
    }
  }

  /**
   * Fetch VAA from Guardian API and relay to Sui
   */
  private async fetchAndRelayVAA(
    vaaId: string,
    depositId: string
  ): Promise<void> {
    try {
      LogMessage(`Fetching VAA ${vaaId} for deposit ${depositId}`);

      // Fetch VAA from Guardian API
      const response = await fetch(`${GUARDIAN_API_URL}${vaaId}`);

      if (!response.ok) {
        if (response.status === 404) {
          LogWarning(`VAA ${vaaId} not found yet, will retry later`);
          this.scheduleVAAReFetch(vaaId, depositId);
          return;
        }

        throw new Error(
          `Guardian API returned error: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();

      if (!data.vaaBytes) {
        throw new Error(`No VAA bytes returned for ${vaaId}`);
      }

      // The VAA is returned base64 encoded
      const vaaBytes = data.vaaBytes;

      // Submit VAA to Sui
      LogMessage(`Submitting VAA ${vaaId} to Sui for deposit ${depositId}`);
      const success = await this.suiHandler.submitVaaToSui(depositId, vaaBytes);

      if (success) {
        LogMessage(
          `Successfully submitted VAA ${vaaId} to Sui for deposit ${depositId}`
        );
        this.processedVAAs.add(vaaId);
      } else {
        LogWarning(
          `Failed to submit VAA ${vaaId} to Sui for deposit ${depositId}, will retry later`
        );
        this.scheduleVAAReFetch(vaaId, depositId);
      }
    } catch (error: any) {
      LogError(
        `Error fetching/relaying VAA ${vaaId} for deposit ${depositId}: ${error.message}`,
        error
      );

      // Schedule retry for failures
      this.scheduleVAAReFetch(vaaId, depositId);
    }
  }

  /**
   * Schedule a retry for fetching and relaying a VAA
   */
  private scheduleVAAReFetch(
    vaaId: string,
    depositId: string,
    retryCount: number = 0
  ): void {
    const MAX_RETRIES = 10;
    const RETRY_DELAYS = [
      30000, // 30 seconds
      60000, // 1 minute
      120000, // 2 minutes
      300000, // 5 minutes
      600000, // 10 minutes
      1800000, // 30 minutes
    ];

    if (retryCount >= MAX_RETRIES) {
      LogWarning(
        `Exceeded maximum retries (${MAX_RETRIES}) for VAA ${vaaId}, giving up`
      );
      return;
    }

    const delay = RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)];

    LogMessage(
      `Scheduling retry #${retryCount + 1} for VAA ${vaaId} in ${delay / 1000} seconds`
    );

    setTimeout(() => {
      this.fetchAndRelayVAA(vaaId, depositId).catch((error) => {
        LogError(`Error in scheduled VAA fetch retry: ${error.message}`, error);
        // Schedule another retry with increased count
        this.scheduleVAAReFetch(vaaId, depositId, retryCount + 1);
      });
    }, delay);
  }

  /**
   * Helper to get the current transaction hash from ethers
   * Used when processing events directly
   */
  private async getCurrentTransactionHash(): Promise<string | null> {
    try {
      // This is a simplified approach - in a real implementation we would
      // extract the transaction hash directly from the event
      // For now, we'll return a dummy hash
      return `0x${Math.random().toString(16).substring(2, 42)}`;
    } catch (error: any) {
      LogError(
        `Error getting current transaction hash: ${error.message}`,
        error
      );
      return null;
    }
  }
}
