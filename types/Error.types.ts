/**
 * Common error types for the tBTC Cross-Chain Relayer
 * These types replace the usage of 'any' in error handling throughout the codebase
 */

/**
 * Standard error object that may come from various sources
 */
export type ErrorLike = Error | { message: string; code?: string | number } | string | unknown;

/**
 * Prisma-specific error codes we handle
 */
export interface PrismaError extends Error {
  code: string;
  meta?: Record<string, unknown>;
}

/**
 * Blockchain/RPC error from providers like ethers, starknet, etc.
 */
export interface BlockchainError extends Error {
  code?: string | number;
  reason?: string;
  method?: string;
  transaction?: unknown;
  receipt?: unknown;
}

/**
 * HTTP/Network error from external API calls
 */
export interface NetworkError extends Error {
  status?: number;
  statusText?: string;
  url?: string;
  response?: unknown;
}

/**
 * Validation error for input/configuration validation
 */
export interface ValidationError extends Error {
  field?: string;
  value?: unknown;
  expected?: string;
}

/**
 * Type guard to check if error is a Prisma error
 */
export function isPrismaError(error: unknown): error is PrismaError {
  return (
    error instanceof Error && 'code' in error && typeof (error as PrismaError).code === 'string'
  );
}

/**
 * Type guard to check if error is a blockchain error
 */
export function isBlockchainError(error: unknown): error is BlockchainError {
  return error instanceof Error && ('code' in error || 'reason' in error);
}

/**
 * Type guard to check if error is a network error
 */
export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof Error && ('status' in error || 'statusText' in error);
}

/**
 * Utility type for serializing errors safely
 */
export interface SerializableError {
  name: string;
  message: string;
  stack?: string;
  code?: string | number;
  [key: string]: unknown;
}

/**
 * Convert any error-like object to a serializable error
 */
export function toSerializableError(error: ErrorLike): SerializableError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(isPrismaError(error) && { code: error.code }),
      ...(isBlockchainError(error) && {
        code: error.code,
        reason: error.reason,
      }),
      ...(isNetworkError(error) && {
        status: error.status,
        statusText: error.statusText,
      }),
    };
  }

  if (typeof error === 'string') {
    return {
      name: 'Error',
      message: error,
    };
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const errorObj = error as Record<string, unknown>;
    const errorMessage = errorObj.message;
    return {
      name: 'Error',
      message: String(errorMessage ?? 'Unknown error'),
      ...errorObj,
    };
  }

  return {
    name: 'UnknownError',
    message: String(error ?? 'Unknown error'),
  };
}
