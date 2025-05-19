import { Deposit } from '../types/Deposit.type.js';
import { logErrorContext } from './Logger.js';
import { DepositStatus } from '../types/DepositStatus.enum.js';

import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------
// ------------------------- JSON UTILS --------------------------
// ---------------------------------------------------------------

const JSON_PATH = process.env.JSON_PATH || './data';
const dirPath = path.resolve('.', JSON_PATH);

const checkAndCreateDataFolder = () => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath);
  }
};

/**
 * Get the filename of a JSON operation
 * @param {String} operationId Operation ID
 * @returns {String} Filename of the JSON operation
 */
const getFilename = (operationId: string): string =>
  path.resolve('.', `${JSON_PATH}${operationId}.json`);

/**
 * Check if a JSON object is empty
 * @param {Object} json JSON object
 * @returns {boolean} True if the JSON object is empty, false otherwise
 */
const isEmptyJson = (json: JSON): boolean => Object.keys(json).length === 0;

/**
 * Check if a string is a valid JSON
 * @param {String} content JSON content
 * @returns {boolean} True if the string is a valid JSON, false otherwise
 */
const isValidJson = (content: string): boolean => {
  try {
    JSON.parse(content);
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Check if a JSON operation exists
 * @param {String} operationId Operation ID
 * @returns {boolean} True if the JSON operation exists and is valid, false otherwise
 */
const checkIfExistJson = (operationId: string): boolean => {
  const filename = getFilename(operationId);
  try {
    if (fs.existsSync(filename)) {
      const fileContent = fs.readFileSync(filename, 'utf8');
      return isValidJson(fileContent);
    }
  } catch (error) {
    logErrorContext(`Error checking JSON file existence for ID ${operationId}:`, error);
  }
  return false;
};

/**
 * Get all JSON files in the JSON directory
 * @returns {Promise<Array<Deposit>>} List of JSON files
 */
const getAllJsonOperations = async (): Promise<Array<Deposit>> => {
  checkAndCreateDataFolder();

  const files = await fs.promises.readdir(dirPath);
  const jsonFiles = files.filter(
    (file: string) => path.extname(file) === '.json'
  );

  const promises = jsonFiles.map(async (file: string) => {
    const filePath = path.join(dirPath, file);
    const data = await fs.promises.readFile(filePath, 'utf8');
    if (!isValidJson(data)) {
      logErrorContext(`Invalid JSON file detected: ${filePath}`, new Error('Invalid JSON content'));
      return null;
    }
    return JSON.parse(data);
  });

  const results = await Promise.all(promises);
  // Clean null values
  return results.filter((result: Deposit | null) => result !== null) as Array<Deposit>;
};

/**
 * Get all JSON operations by status
 * @param {DepositStatus} status Operation status enum value (NUMERIC)
 * @returns {Array} List of JSON operations by status
 */
export const getAllJsonOperationsByStatus = async (
  status: DepositStatus // Parameter is still the Enum type
): Promise<Array<Deposit>> => {
  const operations = await getAllJsonOperations(); // operations is Deposit[]
  // operation.status is now type 'number' (from Deposit interface)
  // status is type 'DepositStatus' (numeric enum)
  // This comparison (number === numeric enum) should now pass type checking
  return operations.filter((operation: Deposit) => operation.status === status);
};

// ---------------------------------------------------------------
// ------------------------- JSON CORE ---------------------------
// ---------------------------------------------------------------

/**
 * Get a JSON operation by its ID
 * @param {String} operationId Operation ID
 * @returns {Object|null} The JSON operation if it exists, null otherwise
 */
const getJsonById = (operationId: string): Deposit | null => {
  if (checkIfExistJson(operationId)) {
    try {
      const filename = getFilename(operationId);
      const fileContent = fs.readFileSync(filename, 'utf8');
      return JSON.parse(fileContent);
    } catch (error) {
      logErrorContext(`Error reading JSON file by ID ${operationId}:`, error);
    }
  }
  return null;
};

/**
 * Write a JSON object to a file
 * @param {Object} data JSON data
 * @param {String} operationId Operation ID
 * @returns {boolean} True if the JSON data was written successfully, false otherwise
 */
const writeJson = (data: Deposit, operationId: string): boolean => {
  checkAndCreateDataFolder();

  const filename = getFilename(operationId);

  try {
    const json = JSON.stringify(data, null, 2);
    fs.writeFileSync(filename, json, 'utf8');
    return true;
  } catch (error) {
    logErrorContext(`Error writing JSON file for ID ${operationId}:`, error);
    return false;
  }
};

/**
 * Delete a JSON operation by its ID
 * @param {String} operationId Operation ID
 * @returns {boolean} True if the JSON data was deleted successfully, false otherwise
 */
const deleteJson = (operationId: string): boolean => {
  const filename = getFilename(operationId);
  try {
    if (fs.existsSync(filename)) {
      fs.unlinkSync(filename);
      return true;
    }
  } catch (error) {
    logErrorContext(`Error deleting JSON file for ID ${operationId}:`, error);
  }
  return false;
};

export {
  // Create data folder
  checkAndCreateDataFolder,

  // Utils
  isEmptyJson,
  isValidJson,
  checkIfExistJson,

  // JSON Core
  getJsonById,
  writeJson,
  deleteJson,
  getAllJsonOperations,
};
