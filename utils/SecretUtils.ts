/**
 * Simple utilities for handling secrets
 * Replaces the over-engineered SecretsManager system
 */

import { CHAIN_TYPE } from '../config/schemas/common.schema.js';
import { PRIVATE_KEY_PATTERNS } from '../config/constants/privateKeyPatterns.js';

/**
 * Validate a private key for a specific chain type
 */
export function validatePrivateKey(
  privateKey: string,
  chainType: CHAIN_TYPE,
): {
  valid: boolean;
  error?: string;
} {
  const validation = PRIVATE_KEY_PATTERNS[chainType];
  if (!validation) {
    return {
      valid: false,
      error: `Unsupported chain type: ${chainType}`,
    };
  }

  if (!privateKey) {
    return {
      valid: false,
      error: 'Private key is required',
    };
  }

  if (!validation.pattern.test(privateKey)) {
    return {
      valid: false,
      error: `Invalid ${chainType.toLowerCase()} private key format. Expected: ${validation.description}`,
    };
  }

  return { valid: true };
}

/**
 * Sanitize a value for logging (masks sensitive data)
 */
export function sanitizeForLogging(
  value: string | undefined,
  options?: {
    showPartial?: boolean;
    maskChar?: string;
  },
): string {
  if (!value) {
    return '<not set>';
  }

  const { showPartial = true, maskChar = '*' } = options || {};
  const mask = maskChar.repeat(3);

  if (showPartial && value.length > 8) {
    // Show first 4 characters + mask
    return `${value.substring(0, 4)}${mask}`;
  }

  return mask;
}

/**
 * Sanitize an object for logging (masks any sensitive fields)
 */
export function sanitizeObjectForLogging(
  obj: Record<string, unknown>,
  options?: {
    exclude?: string[];
    showPartial?: boolean;
  },
): Record<string, unknown> {
  // Default behavior: showPartial=true when no options, false when options provided but showPartial not specified
  const defaultShowPartial = options === undefined ? true : false;
  const { exclude = [], showPartial = defaultShowPartial } = options || {};
  const sanitized: Record<string, unknown> = {};

  const sensitiveKeywords = [
    'secret',
    'key',
    'password',
    'token',
    'auth',
    'credential',
    'private',
    'api',
    'bearer',
    'jwt',
    'oauth',
    'passphrase',
  ];

  const isSensitiveKey = (key: string): boolean => {
    const lowerKey = key.toLowerCase();
    return sensitiveKeywords.some((keyword) => lowerKey.includes(keyword));
  };

  for (const [key, value] of Object.entries(obj)) {
    if (exclude.includes(key)) {
      sanitized[key] = value;
    } else if (isSensitiveKey(key) && typeof value === 'string') {
      sanitized[key] = sanitizeForLogging(value, { showPartial });
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeObjectForLogging(value as Record<string, unknown>, options);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

