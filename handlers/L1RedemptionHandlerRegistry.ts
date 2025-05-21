import { L1RedemptionHandler } from './L1RedemptionHandler.js';
import type { AnyChainConfig } from '../config/index.js';
import logger from '../utils/Logger.js';
import { ethers } from 'ethers';

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
    const l1SignerAddress = new ethers.Wallet(chainConfig.privateKey).address;
    const key = this.generateKey(chainConfig.l1Rpc, chainConfig.l1ContractAddress, l1SignerAddress);

    if (!this.handlers.has(key)) {
      logger.info(`Creating new L1RedemptionHandler instance for key: ${key}`);
      const handler = new L1RedemptionHandler(
        chainConfig.l1Rpc,
        chainConfig.l1ContractAddress,
        chainConfig.privateKey,
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
