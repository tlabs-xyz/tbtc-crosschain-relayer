/**
 * Setup Test Database
 * Creates the test database if it doesn't exist
 */

import { execSync } from 'child_process';

/**
 * Ensure test database exists
 */
export async function ensureTestDatabase(): Promise<void> {
  const dbUrl =
    process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';

  try {
    // Try to create the test database
    execSync(`psql "${dbUrl}" -c "CREATE DATABASE test_db;"`, {
      stdio: 'pipe',
    });
    console.log('Test database created successfully');
  } catch (error) {
    // Database might already exist, which is fine
    if (error && typeof error === 'object' && 'stderr' in error) {
      const stderr = error.stderr?.toString() || '';
      if (!stderr.includes('already exists')) {
        console.error('Failed to create test database:', stderr);
        throw error;
      }
    }
  }
}

// Run if called directly
if (require.main === module) {
  ensureTestDatabase().catch((error) => {
    console.error('Failed to setup test database:', error);
    process.exit(1);
  });
}
