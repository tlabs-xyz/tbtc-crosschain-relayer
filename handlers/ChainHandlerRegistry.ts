import type { ChainHandlerInterface } from '../interfaces/ChainHandler.interface.js';
import { ChainHandlerFactory } from './ChainHandlerFactory.js';
import type { AnyChainConfig } from '../config/index.js';

class ChainHandlerRegistry {
  private handlers: Map<string, ChainHandlerInterface> = new Map();

  // Register a handler for a chainId (or chainName)
  register(chainId: string, handler: ChainHandlerInterface): void {
    this.handlers.set(chainId, handler);
  }

  // Get a handler by chainId (or chainName)
  get(chainId: string): ChainHandlerInterface | undefined {
    return this.handlers.get(chainId);
  }

  // List all handlers
  list(): ChainHandlerInterface[] {
    return Array.from(this.handlers.values());
  }

  // Filter handlers by a predicate
  filter(predicate: (handler: ChainHandlerInterface) => boolean): ChainHandlerInterface[] {
    return this.list().filter(predicate);
  }

  // Initialize handlers from configs (idempotent)
  async initialize(configs: AnyChainConfig[]): Promise<void> {
    for (const config of configs) {
      const handler = ChainHandlerFactory.createHandler(config);
      const handlerExists = this.get(config.chainName) !== undefined;
      if (handler && !handlerExists) {
        this.register(config.chainName, handler);
      }
    }
  }

  // For testability: clear all handlers
  clear(): void {
    this.handlers.clear();
  }
}

export const chainHandlerRegistry = new ChainHandlerRegistry();
export { ChainHandlerRegistry };
