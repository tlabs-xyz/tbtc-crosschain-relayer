import { L1RedemptionHandler } from './L1RedemptionHandler';
import type { AnyChainConfig } from '../config/index';
import logger from '../utils/Logger';
import { ethers } from 'ethers';
import { CHAIN_TYPE } from '../config/schemas/common.schema';
import type { EvmChainConfig } from '../config/schemas/evm.chain.schema';

/**
 * Manages L1RedemptionHandler instances.
 * Uses a composite key based on L1 RPC URL, L1 contract address, and L1 signer address
 * to reuse handlers for chains sharing the same L1 configuration.
 */
class L1RedemptionHandlerRegistry {
  private handlers: Map<string, L1RedemptionHandler> = new Map();

  private generateKey(
    l1RpcUrl: string,
    l1ContractAddress: string,
    l1SignerAddress: string,
  ): string {
    return `${l1RpcUrl.toLowerCase()}-${l1ContractAddress.toLowerCase()}-${l1SignerAddress.toLowerCase()}`;
  }

  public get(chainConfig: AnyChainConfig): L1RedemptionHandler {
    if (chainConfig.chainType !== CHAIN_TYPE.EVM) {
      const errorMsg = `L1RedemptionHandler is only applicable to EVM chains. Chain ${chainConfig.chainName} is of type ${chainConfig.chainType}.`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
    // Now we know it's an EVM chain
    const evmConfig = chainConfig as EvmChainConfig;

    if (!evmConfig.privateKey) {
      const errorMsg = `Private key is missing for EVM chain ${evmConfig.chainName} in L1RedemptionHandlerRegistry.`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    const l1SignerAddress = new ethers.Wallet(evmConfig.privateKey).address;
    const key = this.generateKey(evmConfig.l1Rpc, evmConfig.l1ContractAddress, l1SignerAddress);

    if (!this.handlers.has(key)) {
      logger.info(`Creating new L1RedemptionHandler instance for key: ${key}`);
      const handler = new L1RedemptionHandler(
        evmConfig.l1Rpc,
        evmConfig.l1ContractAddress,
        evmConfig.privateKey,
      );
      this.handlers.set(key, handler);
      return handler;
    }
    logger.debug(`Reusing existing L1RedemptionHandler instance for key: ${key}`);
    return this.handlers.get(key)!;
  }

  public list(): L1RedemptionHandler[] {
    return Array.from(this.handlers.values());
  }

  public clear(): void {
    this.handlers.clear();
    logger.info('L1RedemptionHandlerRegistry cleared.');
  }
}

export const l1RedemptionHandlerRegistry = new L1RedemptionHandlerRegistry();
