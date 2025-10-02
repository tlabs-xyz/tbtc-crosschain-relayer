import { getEnv, getEnvNumber } from '../utils/Env.js';
import { ExecutorConfigSchema, type ExecutorConfig } from './schemas/executor.schema.js';

/**
 * Load and validate executor configuration from environment variables
 */
export function loadExecutorConfig(): ExecutorConfig {
  const config = {
    apiUrl: getEnv('EXECUTOR_API_URL', 'https://executor.labsapis.com/v0/quote'),
    timeout: getEnvNumber('EXECUTOR_API_TIMEOUT', 30000),
    defaultGasLimit: getEnvNumber('EXECUTOR_DEFAULT_GAS_LIMIT', 500000),
    defaultFeeBps: getEnvNumber('EXECUTOR_DEFAULT_FEE_BPS', 0),
    defaultFeeRecipient: getEnv('EXECUTOR_DEFAULT_FEE_RECIPIENT', '0x0000000000000000000000000000000000000000'),
  };

  try {
    return ExecutorConfigSchema.parse(config);
  } catch (error: any) {
    throw new Error(`Invalid executor configuration: ${error.message}`);
  }
}

/**
 * Default executor configuration
 */
export const executorConfig = loadExecutorConfig();
