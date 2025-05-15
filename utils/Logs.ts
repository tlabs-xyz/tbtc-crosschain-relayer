import { getStringDate } from './Dates.js';

const APP_NAME = (
  process.env.APP_NAME || 'tBTC Cross-Chain Relayer'
).toUpperCase();
const VERBOSE_APP = process.env.VERBOSE_APP === 'true';

// ---------------------------------------------------------------
// --------------------- UTILITY FUNCTIONS -----------------------
// ---------------------------------------------------------------

/**
 * @name formatLog
 * @description Format the log message
 * @param {string} message
 * @returns {string}
 */
const formatLog = (message: string): string => {
  const timestamp: string = getStringDate();
  return `[${APP_NAME}] | ${timestamp} | ${message}`;
};

// ---------------------------------------------------------------
// --------------------- LOG FUNCTIONS ---------------------------
// ---------------------------------------------------------------
/**
 * @name LogMessage
 * @description Log a message
 * @param {string} message
 * @returns {void}
 */
const LogMessage = (message: string): void => {
  if (!VERBOSE_APP) return;
  const log: string = formatLog(message);
  console.log(log); // NO BORRAR..
};

/**
 * @name LogError
 * @description Log an error
 * @param {string} message
 * @param {Error} error
 * @returns {void}
 */

const LogError = (message: string, error: Error): void => {
  const log = formatLog(message);
  console.error(log, error);
};

/**
 * @name LogWarning
 *  @description Log a warning
 * @param {string} message
 * @returns {void}
 */
const LogWarning = (message: string): void => {
  const log = formatLog(message);
  console.warn(log);
};

// ---------------------------------------------------------------
// --------------------- EXPORTS ---------------------------------
// ---------------------------------------------------------------

export { LogMessage, LogError, LogWarning };
