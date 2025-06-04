const { execSync } = require('child_process');

module.exports = async () => {
  // Ensure the Postgres schema is up to date before tests
  // Using `db push` as a more direct way to ensure schema matches for tests.

  // Use DATABASE_URL from environment, with fallback for local development
  const testDatabaseUrl =
    process.env.DATABASE_URL ||
    'postgresql://test_user:test_password@localhost:5433/tbtc_relayer_test?schema=public';

  // Set the test database URL for Prisma commands
  const testEnv = {
    ...process.env,
    DATABASE_URL: testDatabaseUrl,
  };

  execSync('npx prisma db push --force-reset --accept-data-loss', {
    stdio: 'inherit',
    env: testEnv,
  });
};
