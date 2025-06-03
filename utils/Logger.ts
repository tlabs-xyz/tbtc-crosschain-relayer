import pino from 'pino';

const APP_NAME = (process.env.APP_NAME || 'tBTC Cross-Chain Relayer').toUpperCase();

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: {
    appName: APP_NAME,
  },
  transport:
    process.env.NODE_ENV !== 'production'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});

export default logger;

/**
 * Logs an error with structured context.
 * If the error is an instance of Error, it's logged under the 'err' key (Pino convention).
 * Otherwise, it's logged under 'errorData'.
 * @param message The primary log message.
 * @param error The error object or data.
 */
export const logErrorContext = (message: string, error: Error | unknown) => {
  const logDetails: { err?: Error; errorData?: unknown } = {};
  if (error instanceof Error) {
    logDetails.err = error;
  } else {
    logDetails.errorData = error;
  }
  logger.error(logDetails, message);
};

/**
 * Logs a standardized error message for chain-specific cron jobs.
 * @param chainName - The name of the chain where the error occurred.
 * @param cronJobName - A descriptive name of the cron job (e.g., "deposit processing", "redemption processing").
 * @param error - The error object.
 */
export function logChainCronError(
  chainName: string,
  cronJobName: string,
  error: Error | unknown,
): void {
  logErrorContext(`Error in ${cronJobName} cron job for chain ${chainName}:`, error);
}

/**
 * Logs a standardized error message for global (non-chain-specific) cron jobs.
 * @param cronJobName - A descriptive name of the cron job (e.g., "deposit cleanup").
 * @param error - The error object.
 */
export function logGlobalCronError(cronJobName: string, error: Error | unknown): void {
  logErrorContext(`Error in global ${cronJobName} cron job:`, error);
}
