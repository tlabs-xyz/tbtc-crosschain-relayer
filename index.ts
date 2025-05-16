// -------------------------------------------------------------------------
// |                              IMPORTS                                  |
// -------------------------------------------------------------------------
// Express Server
import express, { Express, RequestHandler } from 'express';

// Security
import cors from 'cors';
import helmet from 'helmet';

// Compression
import compression from 'compression';

// Rutas
import Routes from './routes/Routes.js';

// Utils
import logger from './utils/Logger.js';
import { initializeChain, initializeL2RedemptionService } from './services/Core.js';
import { initializeAuditLog } from './utils/AuditLog.js';
import { logErrorContext } from './utils/Logger.js';

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
    })
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
  logger.warn('Application starting in API_ONLY_MODE. Services will not be initialized.');
}

// Initialize Audit Log System
if (!API_ONLY_MODE) {
  try {
    initializeAuditLog();
    logger.info('Audit log initialized.');
  } catch (error: any) {
    logErrorContext('Failed to initialize audit log:', error);
    process.exit(1);
  }
} else {
  logger.info('Skipping Audit Log initialization due to API_ONLY_MODE.');
}

// Initialize chain handler
(async () => {
  if (!API_ONLY_MODE) {
    try {
      logger.info('Attempting to initialize chain handler...');
      const success = await initializeChain();
      if (!success) {
        logErrorContext('Failed to initialize chain handler.', new Error('initializeChain returned false'));
        process.exit(1);
      }
      logger.info('Chain handler initialized successfully.');

      logger.info('Attempting to initialize L2 redemption listener...');
      const redemptionSuccess = await initializeL2RedemptionService();
      if (!redemptionSuccess) {
        logErrorContext('Failed to initialize L2 redemption listener.', new Error('Failed to initialize L2 redemption listener.'));
        process.exit(1)
      }

      const { startCronJobs } = await import('./services/Core.js');
      startCronJobs();
      logger.info('Cron jobs started.');
    } catch (error: any) {
      logErrorContext(
        'FATAL: Failed to initialize chain handler or dependent services:',
        error
      );
      process.exit(1);
    }
  } else {
    logger.info('Skipping Chain Handler and Cron Jobs initialization due to API_ONLY_MODE.');
  }

  app.listen({ port: PORT, host: '0.0.0.0' });

  // Log successful initialization
  logger.info(`Server listening on port ${PORT}`);
})();
