/**
 * Tests for Secret Utilities
 */

import {
  validatePrivateKey,
  sanitizeForLogging,
  sanitizeObjectForLogging,
} from '../../../utils/SecretUtils.js';
import { CHAIN_TYPE } from '../../../config/schemas/common.schema.js';

describe('Secret Utilities', () => {
  describe('sanitizeForLogging', () => {
    it('should sanitize a secret value with partial display', () => {
      const sanitized = sanitizeForLogging('supersecretvalue');
      expect(sanitized).toBe('supe***');
    });

    it('should fully mask short secrets', () => {
      const sanitized = sanitizeForLogging('short');
      expect(sanitized).toBe('***');
    });

    it('should handle undefined secrets', () => {
      const sanitized = sanitizeForLogging(undefined);
      expect(sanitized).toBe('<not set>');
    });

    it('should handle empty string', () => {
      const sanitized = sanitizeForLogging('');
      expect(sanitized).toBe('<not set>');
    });

    it('should use custom mask character', () => {
      const sanitized = sanitizeForLogging('supersecretvalue', { maskChar: '#' });
      expect(sanitized).toBe('supe###');
    });

    it('should hide entire value when showPartial is false', () => {
      const sanitized = sanitizeForLogging('supersecretvalue', { showPartial: false });
      expect(sanitized).toBe('***');
    });
  });

  describe('sanitizeObjectForLogging', () => {
    it('should sanitize objects containing secret keys', () => {
      const obj = {
        privateKey: 'secret123456789',
        apiKey: 'apikey123',
        normalData: 'visible',
        password: 'mypassword123',
        authToken: 'bearer-token-xyz',
      };

      const sanitized = sanitizeObjectForLogging(obj);
      expect(sanitized.privateKey).toBe('secr***');
      expect(sanitized.apiKey).toBe('apik***');
      expect(sanitized.normalData).toBe('visible');
      expect(sanitized.password).toBe('mypa***');
      expect(sanitized.authToken).toBe('bear***');
    });

    it('should handle nested objects', () => {
      const obj = {
        config: {
          privateKey: 'nested-secret-key',
          publicData: 'visible',
          auth: {
            token: 'deep-nested-token',
            user: 'username',
          },
        },
        normalField: 'normal',
      };

      const sanitized = sanitizeObjectForLogging(obj);
      expect((sanitized.config as any).privateKey).toBe('nest***');
      expect((sanitized.config as any).publicData).toBe('visible');
      expect((sanitized.config as any).auth.token).toBe('deep***');
      expect((sanitized.config as any).auth.user).toBe('username');
      expect(sanitized.normalField).toBe('normal');
    });

    it('should respect exclude list', () => {
      const obj = {
        privateKey: 'secret123',
        apiKey: 'api123',
        excludedSecret: 'should-be-visible',
      };

      const sanitized = sanitizeObjectForLogging(obj, {
        exclude: ['excludedSecret'],
        showPartial: false,
      });
      expect(sanitized.privateKey).toBe('***');
      expect(sanitized.apiKey).toBe('***');
      expect(sanitized.excludedSecret).toBe('should-be-visible');
    });

    it('should handle arrays and null values', () => {
      const obj = {
        secrets: ['not-sanitized'],
        nullSecret: null,
        undefinedSecret: undefined,
        privateKey: 'secret123',
      };

      const sanitized = sanitizeObjectForLogging(obj);
      expect(sanitized.secrets).toEqual(['not-sanitized']);
      expect(sanitized.nullSecret).toBe(null);
      expect(sanitized.undefinedSecret).toBe(undefined);
      expect(sanitized.privateKey).toBe('secr***');
    });
  });

  describe('Private Key Validation', () => {
    describe('EVM', () => {
      it('should validate correct EVM private keys', () => {
        const validKeys = [
          '0x' + 'a'.repeat(64),
          '0x' + '1234567890abcdef'.repeat(4),
          '0x' + 'F'.repeat(64),
          'a'.repeat(64), // Valid without 0x prefix
          '1234567890abcdef'.repeat(4), // Valid without 0x prefix
        ];

        validKeys.forEach((key) => {
          const result = validatePrivateKey(key, CHAIN_TYPE.EVM);
          expect(result.valid).toBe(true);
        });
      });

      it('should reject invalid EVM private keys', () => {
        const invalidKeys = [
          '0x' + 'a'.repeat(63), // Too short
          '0x' + 'a'.repeat(65), // Too long
          'a'.repeat(63), // Too short (without 0x prefix)
          'a'.repeat(65), // Too long (without 0x prefix)
          '0x' + 'g'.repeat(64), // Invalid hex characters
          '0xABCDEF', // Too short
          '', // Empty
        ];

        invalidKeys.forEach((key) => {
          const result = validatePrivateKey(key, CHAIN_TYPE.EVM);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
        });
      });
    });

    describe('Solana', () => {
      it('should validate correct Solana private keys', () => {
        const validKeys = [
          'A'.repeat(44), // Base58 - 44 chars
          'B'.repeat(43), // Base58 - 43 chars
          'HXtBm8XZbxaTt41uqaKhwUAa6Z1aPyvJdsZVENiWsetg', // Real-looking base58
        ];

        validKeys.forEach((key) => {
          const result = validatePrivateKey(key, CHAIN_TYPE.SOLANA);
          expect(result.valid).toBe(true);
        });
      });

      it('should reject invalid Solana private keys', () => {
        const invalidKeys = [
          'A'.repeat(42), // Too short
          'A'.repeat(45), // Too long
          'invalid!@#', // Invalid characters
          '0xabcdef', // Wrong format
          '', // Empty
        ];

        invalidKeys.forEach((key) => {
          const result = validatePrivateKey(key, CHAIN_TYPE.SOLANA);
          expect(result.valid).toBe(false);
        });
      });
    });

    describe('Starknet', () => {
      it('should validate correct Starknet private keys', () => {
        const validKeys = [
          '0x1', // Single hex digit
          '0xabcdef',
          '0x' + '1'.repeat(63), // Max length
        ];

        validKeys.forEach((key) => {
          const result = validatePrivateKey(key, CHAIN_TYPE.STARKNET);
          expect(result.valid).toBe(true);
        });
      });

      it('should reject invalid Starknet private keys', () => {
        const invalidKeys = [
          '0x', // No hex digits
          '0x' + '1'.repeat(64), // Too long
          'abcdef', // Missing 0x
          '0xGHIJKL', // Invalid hex
          '', // Empty
        ];

        invalidKeys.forEach((key) => {
          const result = validatePrivateKey(key, CHAIN_TYPE.STARKNET);
          expect(result.valid).toBe(false);
        });
      });
    });

    describe('Sui', () => {
      it('should validate correct Sui private keys', () => {
        const validKeys = [
          'dGVzdC1rZXktdmFsdWU='.padEnd(44, '='), // Base64
          'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODkwAA==', // Valid base64
        ];

        validKeys.forEach((key) => {
          const result = validatePrivateKey(key, CHAIN_TYPE.SUI);
          expect(result.valid).toBe(true);
        });
      });

      it('should reject invalid Sui private keys', () => {
        const invalidKeys = [
          'not-base64!', // Invalid characters
          'YWJj', // Too short (< 44 chars)
          'A'.repeat(90), // Too long
          '', // Empty
        ];

        invalidKeys.forEach((key) => {
          const result = validatePrivateKey(key, CHAIN_TYPE.SUI);
          expect(result.valid).toBe(false);
        });
      });
    });

    it('should reject unsupported chain types', () => {
      const result = validatePrivateKey('some-key', 'UNKNOWN' as any);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unsupported chain type');
    });

    it('should handle empty private key', () => {
      const result = validatePrivateKey('', CHAIN_TYPE.EVM);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Private key is required');
    });
  });
});
