import { ChainHandlerInterface } from '../interfaces/ChainHandler.interface.js';
import { ChainConfig, ChainType } from '../types/ChainConfig.type.js';
import logger from '../utils/Logger.js';
import { EVMChainHandler } from './EVMChainHandler.js';

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
   * @param config Configuration for the chain
   * @returns An instance of a chain handler
   */
  static createHandler(config: ChainConfig): ChainHandlerInterface {
    logger.info(`Attempting to create chain handler for type: ${config.chainType}`);
    switch (config.chainType) {
      case ChainType.EVM:
        logger.info('Creating EVMChainHandler');
        return new EVMChainHandler(config);

      case ChainType.STARKNET:
        logger.info('Creating StarknetChainHandler');
        return new StarknetChainHandler(config);

      case ChainType.SUI:
        logger.info('Creating SuiChainHandler');
        return new SuiChainHandler(config);

      case ChainType.SOLANA:
        logger.info('Creating SolanaChainHandler');
        return new SolanaChainHandler(config);

      default:
        logger.info(`Unsupported chain type: ${config.chainType}`);
        throw new Error(`Unsupported chain type: ${config.chainType}`);
    }
  }
}
