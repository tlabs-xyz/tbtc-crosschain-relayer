import { z } from 'zod';

export enum NodeEnv {
  DEVELOPMENT = 'development',
  TEST = 'test',
  PRODUCTION = 'production',
}

// Helper to properly parse boolean environment variables
const envBoolean = z
  .union([z.string(), z.boolean()])
  .transform((val) => {
    if (typeof val === 'boolean') return val;
    if (val === 'true' || val === '1') return true;
    if (val === 'false' || val === '0' || val === '') return false;
    throw new Error(`Invalid boolean value: ${val}`);
  });

// Using UPPERCASE for environment variables for easier parsing from dotenv
export const AppConfigSchema = z.object({
  NODE_ENV: z.nativeEnum(NodeEnv).default(NodeEnv.DEVELOPMENT),
  APP_NAME: z.string().min(1, 'APP_NAME is required'),
  APP_VERSION: z.string().min(1, 'APP_VERSION is required'),
  VERBOSE_APP: envBoolean.default(false),
  API_ONLY_MODE: envBoolean.default(false),
  ENABLE_CLEANUP_CRON: envBoolean.default(false),
  HOST_PORT: z.coerce.number().int().positive().default(4000),
  APP_PORT: z.coerce.number().int().positive().default(3000),
  CORS_ENABLED: envBoolean.default(true),
  CORS_URL: z
    .string()
    .url('CORS_URL must be a valid URL')
    .min(1, 'CORS_URL is required if CORS_ENABLED is true')
    .optional(),
  CLEAN_QUEUED_TIME: z.coerce.number().int().positive().default(48),
  CLEAN_FINALIZED_TIME: z.coerce.number().int().positive().default(12),
  CLEAN_BRIDGED_TIME: z.coerce.number().int().positive().default(12),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SUPPORTED_CHAINS: z
    .string()
    .refine(
      (value) => {
        const validChains = [
          'sepoliaTestnet',
          'solanaDevnet',
          'starknetTestnet',
          'suiTestnet',
          'arbitrumMainnet',
          'baseMainnet',
          'baseSepoliaTestnet',
          'solanaDevnetImported',
        ];
        const chains = value.split(',').map((chain) => chain.trim());
        return chains.every((chain) => validChains.includes(chain));
      },
      {
        message: 'SUPPORTED_CHAINS must contain only valid chain names',
      },
    )
    .optional(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
