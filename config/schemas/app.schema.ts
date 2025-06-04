import { z } from 'zod';

export enum NodeEnv {
  DEVELOPMENT = 'development',
  TEST = 'test',
  PRODUCTION = 'production',
}

// Using UPPERCASE for environment variables for easier parsing from dotenv
export const AppConfigSchema = z.object({
  NODE_ENV: z.nativeEnum(NodeEnv).default(NodeEnv.DEVELOPMENT),
  APP_NAME: z.string().min(1, 'APP_NAME is required'),
  APP_VERSION: z.string().min(1, 'APP_VERSION is required'),
  VERBOSE_APP: z.coerce.boolean().default(false),
  API_ONLY_MODE: z.coerce.boolean().default(false),
  ENABLE_CLEANUP_CRON: z.coerce.boolean().default(false),
  HOST_PORT: z.coerce.number().int().positive().default(4000),
  APP_PORT: z.coerce.number().int().positive().default(3000),
  CORS_ENABLED: z.coerce.boolean().default(true),
  CORS_URL: z
    .string()
    .url('CORS_URL must be a valid URL')
    .min(1, 'CORS_URL is required if CORS_ENABLED is true')
    .optional(),
  CLEAN_QUEUED_TIME: z.coerce.number().int().positive().default(48),
  CLEAN_FINALIZED_TIME: z.coerce.number().int().positive().default(12),
  CLEAN_BRIDGED_TIME: z.coerce.number().int().positive().default(12),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SUPPORTED_CHAINS: z.string().optional(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
