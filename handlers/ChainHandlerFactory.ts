import { ChainHandlerInterface } from '../interfaces/ChainHandler.interface.js';
import { ChainConfig, ChainType } from '../types/ChainConfig.type.js';
import { EVMChainHandler } from './EVMChainHandler.js';
import { LogMessage } from '../utils/Logs.js';

// --- Import New Handlers ---
import { StarknetChainHandler } from './StarknetChainHandler.js';
import { SuiChainHandler } from './SuiChainHandler.js';
import { SolanaChainHandler } from './SolanaChainHandler.js';

/**
 * Factory class for creating appropriate chain handlers based on configuration
 */
export class ChainHandlerFactory {
  /**
   * Create a chain handler based on the provided configuration
   * @param chainConfig Configuration for the chain
   * @returns An instance of a chain handler
   */
  static createHandler(chainConfig: ChainConfig): ChainHandlerInterface {
    LogMessage(
      `Factory: Creating chain handler for ${chainConfig.chainName} (${chainConfig.chainType})`
    );

    switch (chainConfig.chainType) {
      case ChainType.EVM:
        return new EVMChainHandler(chainConfig);

      case ChainType.STARKNET:
        return new StarknetChainHandler(chainConfig);

      case ChainType.SUI:
        return new SuiChainHandler(chainConfig);

      case ChainType.SOLANA:
        return new SolanaChainHandler(chainConfig);

      default:
        // Ensure exhaustive check - if new types added, this will error
        const _exhaustiveCheck: never = chainConfig.chainType;
        throw new Error(`Unsupported chain type: ${_exhaustiveCheck}`);
    }
  }
}
