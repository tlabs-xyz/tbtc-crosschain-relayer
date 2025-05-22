import { CHAIN_TYPE } from '../config/schemas/common.schema.js';
import type { SuiChainConfig } from '../config/schemas/sui.chain.schema.js';
import logger from '../utils/Logger.js';
import { BaseChainHandler } from './BaseChainHandler.js';

export class SuiChainHandler extends BaseChainHandler<SuiChainConfig> {
  constructor(config: SuiChainConfig) {
    super(config);
    logger.debug(`Constructing SuiChainHandler for ${this.config.chainName}`);
    if (config.chainType !== CHAIN_TYPE.SUI) {
      throw new Error(`Incorrect chain type ${config.chainType} provided to SuiChainHandler.`);
    }
  }

  protected async initializeL2(): Promise<void> {
    logger.debug(`Initializing Sui L2 components for ${this.config.chainName}`);
    if (this.config.l2Rpc) {
      // TODO: Initialize Sui client (e.g., using @mysten/sui.js)
      // const { SuiClient, getFullnodeUrl } = await import('@mysten/sui');
      // const fullnodeUrl = getFullnodeUrl('testnet'); // Or use this.config.l2Rpc
      // this.suiClient = new SuiClient({ url: fullnodeUrl });
      logger.warn(`Sui L2 client initialization NOT YET IMPLEMENTED for ${this.config.chainName}.`);
    } else {
      logger.warn(`Sui L2 RPC not configured for ${this.config.chainName}. L2 features disabled.`);
    }
  }

  protected async setupL2Listeners(): Promise<void> {
    if (!this.config.useEndpoint) {
      logger.warn(`Sui L2 Listener setup NOT YET IMPLEMENTED for ${this.config.chainName}.`);
      // TODO: Implement Sui event subscription
      // Example: await this.suiClient.subscribeEvent({ filter: { MoveModule: { package: '<PACKAGE_ID>', module: '<MODULE_NAME>' } }, onMessage: callback });
      // Requires Sui Move module equivalent of L2BitcoinDepositor events.
    } else {
      logger.debug(`Sui L2 Listeners skipped for ${this.config.chainName} (using Endpoint).`);
    }
  }

  async getLatestBlock(): Promise<number> {
    if (this.config.useEndpoint) return 0;
    logger.warn(
      `Sui getLatestBlock (checkpoint sequence number) NOT YET IMPLEMENTED for ${this.config.chainName}. Returning 0.`,
    );
    // TODO: Implement logic to get the latest Sui checkpoint sequence number
    // Example: const checkpoint = await this.suiClient.getLatestCheckpointSequenceNumber(); return Number(checkpoint);
    return 0; // Placeholder
  }

  async checkForPastDeposits(_options: {
    pastTimeInMinutes: number;
    latestBlock: number; // Represents checkpoint sequence number
  }): Promise<void> {
    if (this.config.useEndpoint) return;
    logger.warn(`Sui checkForPastDeposits NOT YET IMPLEMENTED for ${this.config.chainName}.`);
    // TODO: Implement logic to query past Sui events
    // Example: await this.suiClient.queryEvents({ query: { MoveModule: { ... } }, order: 'descending', limit: 50 });
    // Will need ways to filter by time or checkpoint range.
  }

  // Override supportsPastDepositCheck if Sui L2 checks are possible
  // supportsPastDepositCheck(): boolean {
  //     const supports = !!(this.config.l2Rpc && !this.config.useEndpoint);
  //     return supports;
  // }
}
