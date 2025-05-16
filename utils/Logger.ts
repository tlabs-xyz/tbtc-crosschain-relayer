import pino from 'pino';

const APP_NAME = (
  process.env.APP_NAME || 'tBTC Cross-Chain Relayer'
).toUpperCase();

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: {
    appName: APP_NAME,
  },
  transport: process.env.NODE_ENV !== 'production' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  } : undefined,
});

export default logger;

/**
 * Logs an error with structured context.
 * If the error is an instance of Error, it's logged under the 'err' key (Pino convention).
 * Otherwise, it's logged under 'errorData'.
 * @param message The primary log message.
 * @param error The error object or data.
 */
export const logErrorContext = (message: string, error: any) => {
  const logDetails: { err?: Error; errorData?: any } = {};
  if (error instanceof Error) {
    logDetails.err = error;
  } else {
    logDetails.errorData = error;
  }
  logger.error(logDetails, message);
}; 