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
import { initializeAllChains, initializeAllL2RedemptionServices, getLoadedChainConfigs, startCronJobs } from './services/Core.js';
import { logErrorContext } from './utils/Logger.js';
import type { ChainConfig } from './types/ChainConfig.type.js';
import { ChainHandlerRegistry } from './handlers/ChainHandlerRegistry.js';
import { setChainHandlerRegistry } from './handlers/ChainHandlerRegistryContext.js';

// -------------------------------------------------------------------------
// |                            APP CONFIG                                 |
// -------------------------------------------------------------------------
// Express app
const app: Express = express();

// Port
const PORT = parseInt(process.env.APP_PORT || '3000', 10);
app.set('port', PORT);

// API Only Mode Flag
const API_ONLY_MODE = process.env.API_ONLY_MODE === 'true';

// -------------------------------------------------------------------------
// |                              SECURITY                                 |
// -------------------------------------------------------------------------

if (process.env.CORS_ENABLED === 'true') {
  app.use(
    cors({
      credentials: true,
      origin: process.env.CORS_URL,
    }),
  );
}

// Helmet (Security middleware)
app.use(helmet());

// Deshabilitar la cabecera X-Powered-By
app.disable('x-powered-by');

// -------------------------------------------------------------------------
// |                              COMPRESSION                              |
// -------------------------------------------------------------------------

// Compresion
app.use(compression() as unknown as RequestHandler);

// File Upload limit
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ limit: '8mb', extended: true }));

// -------------------------------------------------------------------------
// |                                 ROUTES                                |
// -------------------------------------------------------------------------

app.use(Routes);

// -------------------------------------------------------------------------
// |                              SERVER START                             |
// -------------------------------------------------------------------------

// --- Add Log ---
logger.info('Application starting...');

if (API_ONLY_MODE) {
  logger.warn('Application starting in API_ONLY_MODE. Background services will not be initialized.');
} else {
  logger.info('Audit log system would be initialized here (if implemented as a separate module).');
}

// Export app for testing BEFORE listen, and chainConfigs after initialization
// Note: chainConfigs will be populated after the async block
let chainConfigs: ChainConfig[] = [];

const main = async () => {
  const localChainHandlerRegistry = new ChainHandlerRegistry();
  setChainHandlerRegistry(localChainHandlerRegistry);

  if (!API_ONLY_MODE) {
    try {
      logger.info('Attempting to initialize all chain handlers...');
      const loadedConfigs = await initializeAllChains(localChainHandlerRegistry);
      chainConfigs = loadedConfigs;
      if (chainConfigs.length > 0) {
        logger.info(`All chain handlers initialized successfully for: ${chainConfigs.map(c => c.chainName).join(', ')}`);
      } else {
        logger.warn('No chain handlers were initialized. This might be expected if no configurations were found.');
      }

      logger.info('Attempting to initialize all L2 redemption listeners...');
      await initializeAllL2RedemptionServices();
      logger.info('All L2 redemption listeners initialized successfully.');

      startCronJobs(localChainHandlerRegistry);
      logger.info('Cron jobs started.');
    } catch (error: any) {
      logErrorContext('FATAL: Failed to initialize chain handlers or dependent services:', error);
      if (process.env.NODE_ENV !== 'test') {
        process.exit(1);
      }
      throw new Error(`Initialization failed in test mode: ${error.message}`);
    }
  } else {
    logger.info('Skipping Chain Handler and Cron Jobs initialization due to API_ONLY_MODE.');
    if (process.env.NODE_ENV === 'test') {
        const { loadChainConfigs } = await import('./utils/ConfigLoader.js');
        try {
            chainConfigs = await loadChainConfigs();
            logger.info(`Test mode in API_ONLY: Loaded chain configs for: ${chainConfigs.map(c=>c.chainName).join(', ')}`);
        } catch (e) {
            logErrorContext('Test mode in API_ONLY: Failed to load chainConfigs:', e);
        }
    }
  }

  if (process.env.NODE_ENV !== 'test' || process.env.RUN_SERVER_IN_TEST === 'true') {
    app.listen({ port: PORT, host: '0.0.0.0' }, () => {
      logger.info(`Server listening on port ${PORT}`);
    });
  }
};

const initializationPromise = main();

export { app, chainConfigs, initializationPromise };
