import { ChainHandlerInterface } from '../interfaces/ChainHandler.interface.js';
import { ChainConfig, CHAIN_TYPE } from '../types/ChainConfig.type.js';
import { EVMChainHandler } from './EVMChainHandler.js';
import logger from '../utils/Logger.js';

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
      case CHAIN_TYPE.EVM:
        logger.info('Creating EVMChainHandler');
        return new EVMChainHandler(config);

      case CHAIN_TYPE.STARKNET:
        logger.info('Creating StarknetChainHandler');
        return new StarknetChainHandler(config);

      case CHAIN_TYPE.SUI:
        logger.info('Creating SuiChainHandler');
        return new SuiChainHandler(config);

      case CHAIN_TYPE.SOLANA:
        logger.info('Creating SolanaChainHandler');
        return new SolanaChainHandler(config);

      default:
        logger.info(`Unsupported chain type: ${config.chainType}`);
        throw new Error(`Unsupported chain type: ${config.chainType}`);
    }
  }
}
