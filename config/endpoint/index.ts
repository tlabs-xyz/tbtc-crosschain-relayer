/**
 * Standardized Endpoint Configuration Module
 *
 * This module provides a unified approach to endpoint configuration across all chain types.
 *
 * Key Features:
 * - Per-chain useEndpoint configuration
 * - Consistent validation and error handling
 * - Type-safe configuration with Zod schemas
 */

export {
  EndpointConfigurationSchema,
  EndpointConfigurationFactory,
  type EndpointConfiguration,
  type EndpointConfigurationInput,
} from './EndpointConfiguration.js';
