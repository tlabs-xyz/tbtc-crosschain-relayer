import { ChainHandlerInterface } from '../interfaces/ChainHandler.interface';
import { ChainConfig, ChainType } from '../types/ChainConfig.type';
import { EVMChainHandler } from './EVMChainHandler';
import { LogMessage } from '../utils/Logs';

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
      `Creating chain handler for ${chainConfig.chainName} (${chainConfig.chainType})`
    );

    switch (chainConfig.chainType) {
      case ChainType.EVM:
        return new EVMChainHandler(chainConfig);

      case ChainType.STARKNET:
        // For future implementation
        throw new Error(`StarkNet chain handler not yet implemented`);

      case ChainType.SUI:
        // For future implementation
        throw new Error(`Sui chain handler not yet implemented`);

      case ChainType.SOLANA:
        // For future implementation
        throw new Error(`Solana chain handler not yet implemented`);

      default:
        throw new Error(`Unsupported chain type: ${chainConfig.chainType}`);
    }
  }
}
