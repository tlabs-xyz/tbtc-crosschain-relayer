import { z } from 'zod';
import logger from '../../utils/Logger.js';

/**
 * Standard endpoint configuration schema
 */
export const EndpointConfigurationSchema = z.object({
  /**
   * Determines if the relayer should use HTTP endpoints for deposit processing
   * instead of direct L2 event listeners.
   * When true, L2 listeners are disabled, and routes like /api/:chainName/reveal
   * and /api/:chainName/deposit/:depositId become available.
   */
  useEndpoint: z.coerce.boolean(),

  /**
   * Optional URL for external endpoint when useEndpoint is true
   */
  endpointUrl: z.string().url('endpointUrl must be a valid URL').optional(),

  /**
   * When `useEndpoint` is true, this flag specifically controls whether the
   * POST /api/:chainName/reveal endpoint is active for this chain.
   * If `useEndpoint` is true but this is false, the reveal endpoint will return a 405 error.
   * This allows enabling the general endpoint mode while selectively disabling the reveal intake.
   */
  supportsRevealDepositAPI: z.coerce.boolean(),

});

export type EndpointConfiguration = z.infer<typeof EndpointConfigurationSchema>;
export type EndpointConfigurationInput = z.input<typeof EndpointConfigurationSchema>;

/**
 * Endpoint configuration factory
 */
export class EndpointConfigurationFactory {
  /**
   * Create endpoint configuration from chain-specific settings
   * @param chainName Chain name for logging context
   * @param chainInput Chain-specific configuration
   * @returns Parsed and validated endpoint configuration
   */
  static create(
    chainName: string,
    chainInput?: {
      useEndpoint?: boolean;
      endpointUrl?: string;
      supportsRevealDepositAPI?: boolean;
    },
  ): EndpointConfiguration {
    const configInput: EndpointConfigurationInput = {
      useEndpoint: chainInput?.useEndpoint ?? false,
      endpointUrl: chainInput?.endpointUrl,
      supportsRevealDepositAPI: chainInput?.supportsRevealDepositAPI ?? false,
    };

    try {
      const parsed = EndpointConfigurationSchema.parse(configInput);
      logger.debug(
        `Endpoint configuration created for ${chainName}: useEndpoint=${parsed.useEndpoint}, supportsReveal=${parsed.supportsRevealDepositAPI}`,
      );
      return parsed;
    } catch (error) {
      logger.error(`Failed to parse endpoint configuration for ${chainName}:`, error);
      throw new Error(`Invalid endpoint configuration for ${chainName}: ${error}`);
    }
  }

  /**
   * Validate endpoint configuration consistency
   * @param chainName Chain name for logging context
   * @param config Endpoint configuration to validate
   * @returns Validation result with warnings/errors
   */
  static validateConfiguration(
    chainName: string,
    config: EndpointConfiguration,
  ): { isValid: boolean; warnings: string[]; errors: string[] } {
    const warnings: string[] = [];
    const errors: string[] = [];

    // Validate logical consistency
    if (config.useEndpoint && config.supportsRevealDepositAPI && !config.endpointUrl) {
      warnings.push(
        `Chain ${chainName} has useEndpoint=true and supportsRevealDepositAPI=true but no endpointUrl configured`,
      );
    }


    return {
      isValid: errors.length === 0,
      warnings,
      errors,
    };
  }
}
