// -------------------------------------------------------------------------
// |                              IMPORTS                                  |
// -------------------------------------------------------------------------
// Express Server
import express from 'express';
import type { Express, RequestHandler } from 'express';

// Security
import cors from 'cors';
import helmet from 'helmet';

// Compression
import compression from 'compression';

// Rutas
import Routes from './routes/Routes.js';

// Utils
import logger from './utils/Logger.js';
import {
  initializeAllChains,
  initializeAllL2RedemptionServices,
  startCronJobs,
} from './services/Core.js';
import { logErrorContext } from './utils/Logger.js';

import 'dotenv/config';

import { appConfig, chainConfigs } from './config/index.js';

// -------------------------------------------------------------------------
// |                            APP INSTANCE                               |
// -------------------------------------------------------------------------
const app: Express = express();

// -------------------------------------------------------------------------
// |                          MAIN ASYNC FUNCTION                          |
// -------------------------------------------------------------------------
const main = async () => {
  logger.info('Application starting...');

  try {
    logger.info(
      `App Name: ${appConfig.APP_NAME}, Version: ${appConfig.APP_VERSION}, Env: ${appConfig.NODE_ENV}`,
    );
    app.set('port', appConfig.APP_PORT);

    const numLoadedChains = Object.keys(chainConfigs).length;
    if (numLoadedChains === 0 && appConfig.NODE_ENV !== 'test' && !appConfig.API_ONLY_MODE) {
      logger.error('No chain configurations detected');
      process.exit(1);
    }
    logger.info(
      `Loaded ${numLoadedChains} chain configurations via Zod: ${Object.keys(chainConfigs).join(', ')}`,
    );

    if (appConfig.VERBOSE_APP) {
      Object.entries(chainConfigs).forEach(([key, cc]) => {
        logger.debug(`Chain Config [${key}]:`, JSON.stringify(cc, null, 2));
      });
    }
  } catch (error) {
    logErrorContext('FATAL: Failed during initial setup after config loading:', error);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // |                         MIDDLEWARE SETUP                            |
  // -------------------------------------------------------------------------
  if (appConfig.CORS_ENABLED) {
    const corsOptions = {
      credentials: true,
      origin: appConfig.CORS_URL,
    };
    app.use(cors(corsOptions));
    logger.info(`CORS enabled for origin: ${appConfig.CORS_URL || '*'}`);
  }

  app.use(helmet());
  app.disable('x-powered-by');
  app.use(compression() as unknown as RequestHandler);
  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ limit: '8mb', extended: true }));

  // -------------------------------------------------------------------------
  // |                                 ROUTES                                |
  // -------------------------------------------------------------------------
  app.use(Routes);

  // -------------------------------------------------------------------------
  // |                        BACKGROUND SERVICES                          |
  // -------------------------------------------------------------------------
  if (appConfig.API_ONLY_MODE) {
    logger.warn(
      'Application running in API_ONLY_MODE. Background services (chain handlers, cron jobs) will not be initialized.',
    );
  } else {
    try {
      logger.info('Attempting to initialize all chain handlers...');
      await initializeAllChains();

      logger.info('Attempting to initialize all L2 redemption listeners...');
      await initializeAllL2RedemptionServices();
      logger.info('All L2 redemption listeners initialized successfully.');

      startCronJobs();
      logger.info('Cron jobs started.');
    } catch (error: any) {
      logErrorContext('FATAL: Failed to initialize chain handlers or dependent services:', error);
      if (appConfig.NODE_ENV !== 'test') {
        process.exit(1);
      }
      throw new Error(`Initialization failed in test mode: ${error.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // |                              SERVER START                             |
  // -------------------------------------------------------------------------
  if (appConfig.NODE_ENV !== 'test') {
    app.listen({ port: appConfig.APP_PORT, host: '0.0.0.0' }, () => {
      logger.info(`Server listening on port ${appConfig.APP_PORT}`);
    });
  } else {
    logger.info(
      'Server not started in test environment (tests will manage their own server instances if needed).',
    );
  }
  logger.info('Application initialization sequence complete.');
};

// Execute main and capture the promise for export (e.g., for tests to await readiness)
const initializationPromise = main().catch((error) => {
  logErrorContext('Unhandled error during application main execution:', error);
  if (process.env.NODE_ENV !== 'test') {
    process.exit(1);
  }
  throw error;
});

export { app, appConfig, initializationPromise };
