import { LogMessage, LogError } from '../utils/Logs';
import { loadConfig } from '../utils/ConfigLoader';
import { ETHVAASuiRelayer } from '../handlers/ETHVAASuiRelayer';
import { ChainType } from '../types/ChainConfig.type';

const main = async () => {
  try {
    LogMessage('Starting VAA Relayer...');
    
    // Load configuration (prioritizes .env, falls back to config.json)
    const config = loadConfig();
    
    // Get chain configs
    const l1Config = config.chains.l1; // Ethereum
    const l2Config = config.chains.l2; // Could be EVM or non-EVM
    
    // Verify L2 is Sui for this relayer
    if (l2Config.chainType !== ChainType.SUI) {
      throw new Error(`ETHVAASuiRelayer requires L2 to be Sui (got ${l2Config.chainType})`);
    }
    
    // Get token bridge config
    const tokenBridgeConfig = config.wormhole.tokenBridge;
    
    // Create the relayer
    const relayer = new ETHVAASuiRelayer(l1Config, l2Config, tokenBridgeConfig);
    
    // Initialize the relayer
    LogMessage('Initializing relayer...');
    await relayer.initialize();
    
    // Start listening for events
    LogMessage('Starting to listen for events...');
    await relayer.startListening();
    
    // Check for past transfers (last 24 hours, adjust as needed)
    const currentBlock = await (async () => {
      try {
        const provider = new (require('ethers')).providers.JsonRpcProvider(l1Config.l1Rpc);
        return await provider.getBlockNumber();
      } catch (error) {
        LogError(`Failed to get current block: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error : new Error(String(error)));
        return 0;
      }
    })();

    // Ethereum has roughly 7200 blocks per day (15s block time)
    const blocksPerDay = 7200;
    const fromBlock = Math.max(0, currentBlock - blocksPerDay);
    
    LogMessage(`Checking for past token transfers from block ${fromBlock} to ${currentBlock}...`);
    await relayer.checkForPastTransfers({
      fromBlock,
      toBlock: currentBlock
    });
    
    LogMessage('VAA Relayer running...');
    
    // Keep the process running
    process.stdin.resume();
    
    // Handle graceful shutdown
    const shutdown = async () => {
      LogMessage('Shutting down VAA Relayer...');
      process.exit(0);
    };
    
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error: any) {
    LogError(`VAA Relayer error: ${error.message}`, error);
    process.exit(1);
  }
};

// Run main
main().catch((error) => {
  LogError(`Unhandled error: ${error.message}`, error);
  process.exit(1);
}); 