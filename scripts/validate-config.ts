#!/usr/bin/env tsx

/**
 * Configuration Validation Script
 *
 * This script replicates the configuration loading and validation process
 * that occurs during server startup, making it suitable for CI environments
 * and pre-test validation.
 *
 * It validates:
 * - Application configuration (app.config.ts)
 * - Chain configurations specified by SUPPORTED_CHAINS (or all if not set)
 * - Environment variable requirements
 *
 * Exit codes:
 * - 0: All configurations valid
 * - 1: Configuration validation failed
 */

const SCRIPT_NAME = 'validate-config';
let supportedChainsToValidate: string[] = [];

/**
 * Load environment variables if not in CI and parse SUPPORTED_CHAINS
 */
async function loadEnvironment() {
  // Only load dotenv in non-CI environments since CI sets environment variables directly
  if (process.env.CI !== 'true' && process.env.GITHUB_ACTIONS !== 'true') {
    await import('dotenv/config');
  }

  const supportedChainsEnv = process.env.SUPPORTED_CHAINS;
  if (supportedChainsEnv && supportedChainsEnv.trim() !== '') {
    supportedChainsToValidate = supportedChainsEnv
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s);
  }
  // If supportedChainsToValidate is empty here, it means SUPPORTED_CHAINS was not set or was empty.
  // The validation logic will then decide to use all available chains from the registry.
}

/**
 * Dynamically imports modules after environment setup
 */
async function importConfigModules() {
  // Note: chainConfigs is no longer directly imported here.
  // It's loaded by loadAndValidateChainConfigs from config/index.ts
  const [
    { z },
    { default: logger },
    { AppConfigSchema },
    { loadAndValidateChainConfigs, getAvailableChainKeys },
    { writeFileSync },
  ] = await Promise.all([
    import('zod'),
    import('../utils/Logger.js'),
    import('../config/schemas/app.schema'),
    import('../config/index.js'),
    import('fs'),
  ]);

  return {
    z,
    logger,
    AppConfigSchema,
    loadAndValidateChainConfigs,
    getAvailableChainKeys,
    writeFileSync,
  };
}

/**
 * Validates application configuration using the same schema as startup
 */
async function validateAppConfig(): Promise<boolean> {
  const { z, logger, AppConfigSchema, writeFileSync } = await importConfigModules();

  try {
    logger.info(`[${SCRIPT_NAME}] Validating application configuration...`);
    const config = AppConfigSchema.parse(process.env);

    logger.info(`[${SCRIPT_NAME}] App configuration valid:`, {
      APP_NAME: config.APP_NAME,
      APP_VERSION: config.APP_VERSION,
      NODE_ENV: config.NODE_ENV,
      API_ONLY_MODE: config.API_ONLY_MODE,
      numConfigsPresent: Object.keys(config).length,
    });

    return true;
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      logger.error(
        `[${SCRIPT_NAME}] Application configuration validation failed:`,
        error.flatten(),
      );

      const errorDetails = {
        timestamp: new Date().toISOString(),
        type: 'app_config_validation_error',
        flattened: error.flatten(),
        errors: error.errors,
        processEnvRelevantKeys: Object.keys(process.env).filter(
          (key) =>
            key.startsWith('APP_') ||
            key.startsWith('NODE_') ||
            key.startsWith('DATABASE_') ||
            key.startsWith('CORS_') ||
            key.startsWith('HOST_') ||
            key.startsWith('CLEAN_'),
        ),
      };

      try {
        writeFileSync(
          '/tmp/app-config-validation-error.json',
          JSON.stringify(errorDetails, null, 2),
        );
        logger.error(
          `[${SCRIPT_NAME}] Detailed app config error written to /tmp/app-config-validation-error.json`,
        );
      } catch (writeError) {
        logger.error(`[${SCRIPT_NAME}] Failed to write app config error details:`, writeError);
      }
    } else {
      logger.error(
        `[${SCRIPT_NAME}] Unexpected error during application configuration validation:`,
        error,
      );
    }
    return false;
  }
}

/**
 * Validates chain configurations using the new dynamic loading process
 */
async function validateChainConfigs(): Promise<boolean> {
  const { logger, loadAndValidateChainConfigs, getAvailableChainKeys, writeFileSync } =
    await importConfigModules();

  try {
    let chainsToAttemptValidation: string[];
    if (supportedChainsToValidate.length > 0) {
      logger.info(
        `[${SCRIPT_NAME}] Validating chain configurations specified in SUPPORTED_CHAINS: ${supportedChainsToValidate.join(', ')}...`,
      );
      chainsToAttemptValidation = supportedChainsToValidate;
    } else {
      const availableChains = getAvailableChainKeys();
      logger.info(
        `[${SCRIPT_NAME}] SUPPORTED_CHAINS not set or empty. Validating all available chain configurations: ${availableChains.join(', ')}...`,
      );
      chainsToAttemptValidation = availableChains;
      if (chainsToAttemptValidation.length === 0) {
        logger.warn(
          `[${SCRIPT_NAME}] No chains specified via SUPPORTED_CHAINS and no chains available in the registry. This is unusual.`,
        );
        const nodeEnv = process.env.NODE_ENV || 'development';
        const apiOnlyMode = process.env.API_ONLY_MODE === 'true';
        if (nodeEnv !== 'test' && !apiOnlyMode) {
          logger.error(
            `[${SCRIPT_NAME}] No chain configurations to validate and not in test/API_ONLY_MODE. Server would fail to start.`,
          );
          return false;
        }
        logger.info(
          '[${SCRIPT_NAME}] Proceeding without chain config validation as no chains are defined or specified, and in test/API_ONLY_MODE.',
        );
        return true; // Nothing to validate
      }
    }

    const { configs: loadedChainConfigs, validationErrors } = await loadAndValidateChainConfigs(
      chainsToAttemptValidation,
      logger,
    );

    if (validationErrors.length > 0) {
      logger.error(
        `[${SCRIPT_NAME}] Chain configuration validation failed for ${validationErrors.length} chain(s):`,
      );
      logger.error('--------------------------------------------------------------------');
      validationErrors.forEach((err) => {
        logger.error(`Chain Key: '${err.chainKey}'`);
        try {
          logger.error(
            `Input provided for '${err.chainKey}':\n${JSON.stringify(err.input, null, 2)}`,
          );
          logger.error(
            `Error details for '${err.chainKey}':\n${JSON.stringify(err.error, null, 2)}`,
          );
        } catch {
          logger.error(
            `Failed to stringify details for chain '${err.chainKey}'. Logging raw objects:`,
          );
          logger.error('Raw Input:', err.input);
          logger.error('Raw Error:', err.error);
        }
        logger.error('--------------------------------------------------------------------');
      });
      try {
        writeFileSync(
          '/tmp/chain-configs-validation-errors.json',
          JSON.stringify(validationErrors, null, 2),
        );
        logger.error(
          `[${SCRIPT_NAME}] Detailed chain config errors written to /tmp/chain-configs-validation-errors.json`,
        );
      } catch (writeError) {
        logger.error(`[${SCRIPT_NAME}] Failed to write chain config error details:`, writeError);
      }
      return false;
    }

    const numLoadedChains = Object.keys(loadedChainConfigs).length;
    logger.info(`[${SCRIPT_NAME}] Chain configuration validation complete:`, {
      numSuccessfullyLoadedChains: numLoadedChains,
      requestedChains: chainsToAttemptValidation,
      loadedChainKeys: Object.keys(loadedChainConfigs),
      validationResult: 'success',
    });

    // Critical environment variable checks (can remain as they are general)
    const missingEnvVars: string[] = [];
    const criticalEnvVars = ['DATABASE_URL', 'APP_NAME', 'APP_VERSION'];
    criticalEnvVars.forEach((envVar) => {
      if (!process.env[envVar]) {
        missingEnvVars.push(envVar);
      }
    });

    if (missingEnvVars.length > 0) {
      logger.error(`[${SCRIPT_NAME}] Critical environment variables missing:`, missingEnvVars);
      return false;
    }

    // Check if chains were expected but none loaded (e.g. SUPPORTED_CHAINS was set but all failed)
    const nodeEnv = process.env.NODE_ENV || 'development';
    const apiOnlyMode = process.env.API_ONLY_MODE === 'true';

    if (
      chainsToAttemptValidation.length > 0 &&
      numLoadedChains === 0 &&
      nodeEnv !== 'test' &&
      !apiOnlyMode
    ) {
      logger.error(
        `[${SCRIPT_NAME}] No chain configurations were successfully loaded out of the ${chainsToAttemptValidation.length} attempted, and not in test/API_ONLY_MODE. Server would fail to start.`,
      );
      return false;
    }
    if (
      numLoadedChains === 0 &&
      chainsToAttemptValidation.length === 0 &&
      nodeEnv !== 'test' &&
      !apiOnlyMode
    ) {
      // This case is for when SUPPORTED_CHAINS is empty AND no chains are in registry, which was handled earlier.
      // Adding a redundant check here for safety, but primary logic is above.
      logger.error(
        `[${SCRIPT_NAME}] No chain configurations detected (none specified, none in registry) - server would fail to start as not in test/API_ONLY_MODE.`,
      );
      return false;
    }

    return true;
  } catch (error: any) {
    logger.error(
      `[${SCRIPT_NAME}] Unexpected error during chain configuration validation process:`,
      error,
    );
    return false;
  }
}

/**
 * Validates configuration environment readiness
 */
async function validateEnvironmentReadiness(): Promise<boolean> {
  const { logger } = await importConfigModules();

  try {
    logger.info(`[${SCRIPT_NAME}] Validating environment readiness...`);

    const nodeEnv = process.env.NODE_ENV || 'development';
    const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
    const apiOnlyMode = process.env.API_ONLY_MODE === 'true';

    logger.info(`[${SCRIPT_NAME}] Environment status:`, {
      NODE_ENV: nodeEnv,
      CI: isCI,
      API_ONLY_MODE: apiOnlyMode,
      ENABLE_CLEANUP_CRON: process.env.ENABLE_CLEANUP_CRON || 'false',
      DATABASE_URL_SET: !!process.env.DATABASE_URL,
      SUPPORTED_CHAINS_SET: !!process.env.SUPPORTED_CHAINS, // Log if the var itself is set
      NUM_SUPPORTED_CHAINS_TO_VALIDATE: supportedChainsToValidate.length, // Log how many we derived
    });

    if (isCI && !process.env.DATABASE_URL) {
      logger.error(`[${SCRIPT_NAME}] DATABASE_URL must be set in CI environment`);
      return false;
    }

    const requiredForStartup = ['APP_NAME', 'APP_VERSION'];
    const missingRequired = requiredForStartup.filter(
      (key) => !process.env[key] || process.env[key]?.trim() === '',
    );

    if (missingRequired.length > 0) {
      logger.error(
        `[${SCRIPT_NAME}] Required startup environment variables missing or empty:`,
        missingRequired,
      );
      return false;
    }

    logger.info(`[${SCRIPT_NAME}] Environment readiness validation complete - ready for startup`);
    return true;
  } catch (error: any) {
    logger.error(`[${SCRIPT_NAME}] Environment readiness validation failed:`, error);
    return false;
  }
}

/**
 * Gracefully shuts down the script with proper log flushing
 */
async function gracefulShutdown(exitCode: number): Promise<void> {
  // Get logger instance carefully, as importConfigModules might fail if called too early or if error occurs before it's safe
  let loggerInstance;
  try {
    const modules = await importConfigModules();
    loggerInstance = modules.logger;
  } catch (e) {
    // If importing modules fails, logger won't be available. Fallback to console.
    console.error(`[${SCRIPT_NAME}] Failed to import logger for graceful shutdown:`, e);
  }

  if (loggerInstance && typeof (loggerInstance as any).flush === 'function') {
    try {
      await (loggerInstance as any).flush();
    } catch (flushError) {
      console.error(`[${SCRIPT_NAME}] Failed to flush logs:`, flushError);
    }
  }
  process.exitCode = exitCode;
}

/**
 * Main validation function
 */
async function main(): Promise<void> {
  console.log(`[${SCRIPT_NAME}] Starting configuration validation...`);

  await loadEnvironment(); // Loads .env and parses SUPPORTED_CHAINS

  // Now that environment is loaded, we can safely import modules that might depend on it.
  const { logger } = await importConfigModules();
  logger.info(`[${SCRIPT_NAME}] Environment setup complete, beginning validation...`);
  logger.info(
    `[${SCRIPT_NAME}] Chains to validate based on SUPPORTED_CHAINS (or all if empty): ${supportedChainsToValidate.length > 0 ? supportedChainsToValidate.join(', ') : 'ALL_AVAILABLE'}`,
  );

  const startTime = Date.now();
  let allValid = true;

  if (!(await validateAppConfig())) {
    allValid = false;
  }

  // validateChainConfigs now uses supportedChainsToValidate populated by loadEnvironment
  if (allValid && !(await validateChainConfigs())) {
    // Only run if app config is valid
    allValid = false;
  }

  if (allValid && !(await validateEnvironmentReadiness())) {
    // Only run if previous are valid
    allValid = false;
  }

  const duration = Date.now() - startTime;

  if (allValid) {
    logger.info(`[${SCRIPT_NAME}] ✅ All configuration validation passed (${duration}ms)`);
    logger.info(`[${SCRIPT_NAME}] Server startup configuration is ready`);
    await gracefulShutdown(0);
  } else {
    logger.error(`[${SCRIPT_NAME}] ❌ Configuration validation failed (${duration}ms)`);
    logger.error(`[${SCRIPT_NAME}] Server would fail to start with current configuration`);
    await gracefulShutdown(1);
  }
}

// Handle unhandled errors gracefully
process.on('unhandledRejection', async (reason, promise) => {
  // Use console.error here as logger might not be initialized or available
  console.error(`[${SCRIPT_NAME}] Unhandled Rejection at:`, promise, 'reason:', reason);
  // Avoid calling gracefulShutdown if it relies on logger that might not be safe to get
  process.exitCode = 1;
  process.exit(1); // Force exit
});

process.on('uncaughtException', async (error) => {
  console.error(`[${SCRIPT_NAME}] Uncaught Exception:`, error);
  process.exitCode = 1;
  process.exit(1); // Force exit
});

// Execute main function
main().catch(async (error) => {
  // Use console.error for script execution failures as logger might not be safe.
  console.error(`[${SCRIPT_NAME}] Script execution failed catastrophically:`, error);
  process.exitCode = 1;
  process.exit(1); // Force exit
});
