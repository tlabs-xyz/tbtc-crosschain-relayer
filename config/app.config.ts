import logger from '../utils/Logger.js';
import { AppConfigSchema, type AppConfig } from './schemas/app.schema.js';
import { writeFileSync } from 'fs';

export const appConfig: AppConfig = (() => {
  try {
    return AppConfigSchema.parse(process.env);
  } catch (error: any) {
    const errorAsString = JSON.stringify(error, null, 2);
    writeFileSync('error.log', errorAsString);
    logger.error('Application configuration validation failed:', errorAsString);
    process.exit(1);
  }
})();
