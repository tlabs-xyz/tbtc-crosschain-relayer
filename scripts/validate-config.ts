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
 * - All chain configurations (config/index.ts)
 * - Environment variable requirements
 *
 * Exit codes:
 * - 0: All configurations valid
 * - 1: Configuration validation failed
 */

const SCRIPT_NAME = 'validate-config';

/**
 * Load environment variables if not in CI
 */
async function loadEnvironment() {
  // Only load dotenv in non-CI environments since CI sets environment variables directly
  if (process.env.CI !== 'true' && process.env.GITHUB_ACTIONS !== 'true') {
    await import('dotenv/config');
  }
}

/**
 * Dynamically imports modules after environment setup
 */
async function importConfigModules() {
  const [{ z }, { default: logger }, { AppConfigSchema }, { chainConfigs }, { writeFileSync }] =
    await Promise.all([
      import('zod'),
      import('../utils/Logger.js'),
      import('../config/schemas/app.schema.js'),
      import('../config/index.js'),
      import('fs'),
    ]);

  return { z, logger, AppConfigSchema, chainConfigs, writeFileSync };
}

/**
 * Validates application configuration using the same schema as startup
 */
async function validateAppConfig(): Promise<boolean> {
  const { z, logger, AppConfigSchema } = await importConfigModules();

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
    const { logger, writeFileSync } = await importConfigModules();

    if (error instanceof z.ZodError) {
      logger.error(
        `[${SCRIPT_NAME}] Application configuration validation failed:`,
        error.flatten(),
      );

      // Write detailed error for CI debugging
      const errorDetails = {
        timestamp: new Date().toISOString(),
        type: 'app_config_validation_error',
        flattened: error.flatten(),
        errors: error.errors,
        processEnv: Object.keys(process.env).filter(
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
          `[${SCRIPT_NAME}] Detailed error written to /tmp/app-config-validation-error.json`,
        );
      } catch (writeError) {
        logger.error(`[${SCRIPT_NAME}] Failed to write error details:`, writeError);
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
 * Validates chain configurations using the same process as startup
 */
async function validateChainConfigs(): Promise<boolean> {
  const { logger, chainConfigs } = await importConfigModules();

  try {
    logger.info(`[${SCRIPT_NAME}] Validating chain configurations...`);

    const numLoadedChains = Object.keys(chainConfigs).length;
    const chainKeys = Object.keys(chainConfigs);

    logger.info(`[${SCRIPT_NAME}] Chain configuration validation complete:`, {
      numLoadedChains,
      loadedChains: chainKeys,
      validationResult: 'success',
    });

    // Additional validation for CI: check critical environment variables are set
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

    // Log environment readiness for CI
    const nodeEnv = process.env.NODE_ENV || 'development';
    const apiOnlyMode = process.env.API_ONLY_MODE === 'true';

    if (numLoadedChains === 0 && nodeEnv !== 'test' && !apiOnlyMode) {
      logger.error(
        `[${SCRIPT_NAME}] No chain configurations detected - server would fail to start`,
      );
      return false;
    }

    return true;
  } catch (error: any) {
    const { logger } = await importConfigModules();
    logger.error(`[${SCRIPT_NAME}] Chain configuration validation failed:`, error);
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
      SUPPORTED_CHAINS_SET: !!process.env.SUPPORTED_CHAINS,
    });

    // In CI, ensure we have database connectivity config
    if (isCI && !process.env.DATABASE_URL) {
      logger.error(`[${SCRIPT_NAME}] DATABASE_URL must be set in CI environment`);
      return false;
    }

    // Validate essential app configs are not empty
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
    const { logger } = await importConfigModules();
    logger.error(`[${SCRIPT_NAME}] Environment readiness validation failed:`, error);
    return false;
  }
}

/**
 * Gracefully shuts down the script with proper log flushing
 */
async function gracefulShutdown(exitCode: number): Promise<void> {
  const { logger } = await importConfigModules();

  try {
    // Flush logs if the logger supports it (Pino does)
    if (typeof (logger as any).flush === 'function') {
      await (logger as any).flush();
    }
  } catch (flushError) {
    console.error(`[${SCRIPT_NAME}] Failed to flush logs:`, flushError);
  }

  // Set exit code and let Node.js exit naturally
  process.exitCode = exitCode;
}

/**
 * Main validation function
 */
async function main(): Promise<void> {
  console.log(`[${SCRIPT_NAME}] Starting configuration validation...`);

  // Load environment variables first (skip dotenv in CI)
  await loadEnvironment();

  const { logger } = await importConfigModules();
  logger.info(`[${SCRIPT_NAME}] Environment setup complete, beginning validation...`);

  const startTime = Date.now();
  let allValid = true;

  // Validate in the same order as server startup
  if (!(await validateAppConfig())) {
    allValid = false;
  }

  if (!(await validateChainConfigs())) {
    allValid = false;
  }

  if (!(await validateEnvironmentReadiness())) {
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
  console.error(`[${SCRIPT_NAME}] Unhandled Rejection at:`, promise, 'reason:', reason);
  await gracefulShutdown(1);
});

process.on('uncaughtException', async (error) => {
  console.error(`[${SCRIPT_NAME}] Uncaught Exception:`, error);
  await gracefulShutdown(1);
});

// Execute main function
main().catch(async (error) => {
  console.error(`[${SCRIPT_NAME}] Script execution failed:`, error);
  await gracefulShutdown(1);
});
