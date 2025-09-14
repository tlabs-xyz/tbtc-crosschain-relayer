import { L1RedemptionHandler } from './L1RedemptionHandler.js';
import type { AnyChainConfig } from '../config/index.js';
import logger, { logErrorContext } from '../utils/Logger.js';
import type { EvmChainConfig } from '../config/schemas/evm.chain.schema.js';
import { CHAIN_TYPE, NETWORK } from '../config/schemas/common.schema.js';

/**
 * Manages L1RedemptionHandler instances.
 * Uses a composite key based on L1 RPC URL, L1 contract address, and L1 signer address
 * to reuse handlers for chains sharing the same L1 configuration.
 */
class L1RedemptionHandlerRegistry {
  private handler: L1RedemptionHandler | null = null;
  private isInitialized = false;

  public async initialize(chainConfigs: AnyChainConfig[]): Promise<void> {
    if (this.isInitialized) {
      logger.warn('L1RedemptionHandlerRegistry is already initialized.');
      return;
    }

    const evmChainConfigs = chainConfigs.filter(
      (config): config is EvmChainConfig => config.enableL2Redemption && config.chainType === CHAIN_TYPE.EVM,
    );

    if (evmChainConfigs.length === 0) {
      logger.info(
        'No EVM chains with L2 redemption enabled. L1RedemptionHandler will not be created.',
      );
      this.isInitialized = true;
      return;
    }

    // All EVM chains share the same L1. We can pick the L1 RPC and private key from the first configured chain.
    const referenceConfig = evmChainConfigs[0];
    const l1RpcUrl = referenceConfig.l1Rpc;
    const isTestnet = referenceConfig.network === NETWORK.TESTNET;
    const relayerL1PrivateKey = referenceConfig.privateKey;

    if (!relayerL1PrivateKey) {
      // This should theoretically not be hit if schema validation is correct, but it's a good safeguard.
      throw new Error(
        `Private key is missing for EVM chain ${referenceConfig.chainName}. Cannot initialize L1RedemptionHandler.`,
      );
    }

    try {
      this.handler = await L1RedemptionHandler.create(
        l1RpcUrl,
        relayerL1PrivateKey,
        evmChainConfigs,
        isTestnet,
      );
      logger.info('L1RedemptionHandler singleton instance created successfully.');
    } catch (error) {
      logErrorContext('Failed to create L1RedemptionHandler singleton instance', error);
      throw new Error('Could not initialize L1RedemptionHandler.');
    }

    this.isInitialized = true;
  }

  public get(): L1RedemptionHandler | null {
    if (!this.isInitialized) {
      const errorMsg = 'L1RedemptionHandlerRegistry has not been initialized yet.';
      logger.error(errorMsg);
      // Depending on strictness, you might want to throw an error
      // For now, returning null to allow services to fail gracefully if they check the return value.
      return null;
    }
    return this.handler;
  }

  public clear(): void {
    this.handler = null;
    this.isInitialized = false;
    logger.info('L1RedemptionHandlerRegistry cleared and reset.');
  }
}

export const l1RedemptionHandlerRegistry = new L1RedemptionHandlerRegistry();
