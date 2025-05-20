import type { ChainConfig } from '../types/ChainConfig.type.js';
import type { ChainHandlerInterface } from '../interfaces/ChainHandler.interface.js';
import { ChainHandlerFactory } from './ChainHandlerFactory.js';

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
  async initialize(configs: ChainConfig[]): Promise<void> {
    await Promise.all(
      configs.map(async (config) => {
        if (!this.handlers.has(config.chainName)) {
          const handler = ChainHandlerFactory.createHandler(config);
          this.register(config.chainName, handler);
        }
      })
    );
  }

  // For testability: clear all handlers
  clear(): void {
    this.handlers.clear();
  }
}

export const chainHandlerRegistry = new ChainHandlerRegistry();
export type { ChainHandlerRegistry }; 