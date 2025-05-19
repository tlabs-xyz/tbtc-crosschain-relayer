// Use the test Prisma client for test DB in test environment
let PrismaClient: any;
if (process.env.NODE_ENV === 'test') {
  PrismaClient = require('@prisma/client-test').PrismaClient;
} else {
  PrismaClient = require('@prisma/client').PrismaClient;
}

import { Deposit } from '../types/Deposit.type.js';
import { logErrorContext } from './Logger.js';
import { DepositStatus } from '../types/DepositStatus.enum.js';

const prisma = new PrismaClient();

// ---------------------------------------------------------------
// ------------------------- JSON UTILS --------------------------
// ---------------------------------------------------------------

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
 * Check if a Deposit exists by ID
 * @param {String} operationId Operation ID
 * @returns {Promise<boolean>} True if the Deposit exists, false otherwise
 */
const checkIfExistJson = async (operationId: string): Promise<boolean> => {
  try {
    const deposit = await prisma.deposit.findUnique({ where: { id: operationId } });
    return !!deposit;
  } catch (error) {
    logErrorContext(`Error checking Deposit existence for ID ${operationId}:`, error);
    return false;
  }
};

/**
 * Get all Deposits
 * @returns {Promise<Array<Deposit>>} List of Deposits
 */
const getAllJsonOperations = async (): Promise<Array<Deposit>> => {
  try {
    return await prisma.deposit.findMany();
  } catch (error) {
    logErrorContext('Error fetching all Deposits:', error);
    return [];
  }
};

/**
 * Get all Deposits by status
 * @param {DepositStatus} status Operation status enum value
 * @returns {Promise<Array<Deposit>>} List of Deposits by status
 */
export const getAllJsonOperationsByStatus = async (
  status: DepositStatus,
): Promise<Array<Deposit>> => {
  try {
    return await prisma.deposit.findMany({ where: { status } });
  } catch (error) {
    logErrorContext(`Error fetching Deposits by status ${status}:`, error);
    return [];
  }
};

// ---------------------------------------------------------------
// ------------------------- JSON CORE ---------------------------
// ---------------------------------------------------------------

/**
 * Get a Deposit by its ID
 * @param {String} operationId Operation ID
 * @returns {Promise<Deposit|null>} The Deposit if it exists, null otherwise
 */
const getJsonById = async (operationId: string): Promise<Deposit | null> => {
    try {
    return await prisma.deposit.findUnique({ where: { id: operationId } });
    } catch (error) {
    logErrorContext(`Error fetching Deposit by ID ${operationId}:`, error);
    return null;
  }
};

/**
 * Upsert a Deposit
 * @param {Deposit} data Deposit data
 * @param {String} operationId Operation ID
 * @returns {Promise<boolean>} True if the Deposit was written successfully, false otherwise
 */
const writeJson = async (data: Deposit, operationId: string): Promise<boolean> => {
  try {
    await prisma.deposit.upsert({
      where: { id: operationId },
      update: { ...data },
      create: { ...data, id: operationId },
    });
    return true;
  } catch (error) {
    logErrorContext(`Error upserting Deposit for ID ${operationId}:`, error);
    return false;
  }
};

/**
 * Delete a Deposit by its ID
 * @param {String} operationId Operation ID
 * @returns {Promise<boolean>} True if the Deposit was deleted successfully, false otherwise
 */
const deleteJson = async (operationId: string): Promise<boolean> => {
  try {
    await prisma.deposit.delete({ where: { id: operationId } });
      return true;
  } catch (error) {
    logErrorContext(`Error deleting Deposit for ID ${operationId}:`, error);
    return false;
  }
};

export {
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
