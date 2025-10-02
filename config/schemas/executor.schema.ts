import { z } from 'zod';

/**
 * Schema for Wormhole Executor API configuration
 */
export const ExecutorConfigSchema = z.object({
  /**
   * Wormhole Executor API URL
   * @default 'https://executor.labsapis.com/v0/quote'
   */
  apiUrl: z.string().url('Executor API URL must be a valid URL').default('https://executor.labsapis.com/v0/quote'),
  
  /**
   * API request timeout in milliseconds
   * @default 30000 (30 seconds)
   */
  timeout: z.coerce.number().int().positive().default(30000),
  
  /**
   * Default gas limit for destination chain execution
   * @default 500000
   */
  defaultGasLimit: z.coerce.number().int().positive().default(500000),
  
  /**
   * Default fee in basis points (100 = 0.1%, 10000 = 10%)
   * @default 0 (no fee)
   */
  defaultFeeBps: z.coerce.number().int().min(0).max(10000).default(0),
  
  /**
   * Default fee recipient address
   * @default zero address
   */
  defaultFeeRecipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address').default('0x0000000000000000000000000000000000000000'),
});

export type ExecutorConfig = z.infer<typeof ExecutorConfigSchema>;
