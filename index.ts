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
import { LogMessage, LogError, LogWarning } from './utils/Logs.js';
import { initializeChain } from './services/Core.js';
import { initializeAuditLog } from './utils/AuditLog.js';

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
LogMessage('Application starting...');

if (API_ONLY_MODE) {
  LogWarning('Application starting in API_ONLY_MODE. Services will not be initialized.');
}

// Initialize Audit Log System
if (!API_ONLY_MODE) {
  try {
    initializeAuditLog();
    LogMessage('Audit log initialized.');
  } catch (error: any) {
    LogError('Failed to initialize audit log:', error);
    process.exit(1);
  }
} else {
  LogMessage('Skipping Audit Log initialization due to API_ONLY_MODE.');
}

// Initialize chain handler
let chainInitializationSuccess = false;
(async () => {
  if (!API_ONLY_MODE) {
    try {
      LogMessage('Attempting to initialize chain handler...');
      const success = await initializeChain();
      if (!success) {
        LogError('Failed to initialize chain handler.', new Error('Failed to initialize chain handler.'));
        process.exit(1);
      }
      LogMessage('Chain handler initialized successfully.');

      const { startCronJobs } = await import('./services/Core.js');
      startCronJobs();
      LogMessage('Cron jobs started.');
    } catch (error: any) {
      LogError(
        'FATAL: Failed to initialize chain handler or dependent services:',
        error
      );
      process.exit(1);
    }
  } else {
    LogMessage('Skipping Chain Handler and Cron Jobs initialization due to API_ONLY_MODE.');
  }

  app
    .listen(PORT, '0.0.0.0', () => {
      LogMessage(`Server is running on port ${PORT} and listening on all interfaces`);
      if (API_ONLY_MODE) {
        LogWarning('Server is running in API_ONLY_MODE. Most services are not active.');
      } else if (!chainInitializationSuccess) {
        LogWarning(
          'Server started, but chain handler failed to initialize. Service may be degraded.'
        );
      }
    })
    .on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        const errorMessage = `FATAL: Port ${PORT} is already in use.`;
        LogError(errorMessage, new Error(errorMessage));
      } else {
        LogError(`FATAL: Failed to start server:`, err);
      }
      process.exit(1);
    });
})();
