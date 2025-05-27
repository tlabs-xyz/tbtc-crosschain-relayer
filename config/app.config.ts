import { z } from 'zod';
import logger from '../utils/Logger';
import { AppConfigSchema, type AppConfig } from './schemas/app.schema';

export const appConfig: AppConfig = (() => {
  try {
    return AppConfigSchema.parse(process.env);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      logger.error('Application configuration validation failed:', error.flatten());
    } else {
      logger.error('An unexpected error occurred while loading application configuration:', error);
    }
    process.exit(1);
  }
})();
