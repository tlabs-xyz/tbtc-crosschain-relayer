/* eslint-env node */
/* eslint-disable no-undef */
const { execSync } = require('child_process');

async function waitForPostgres(databaseUrl, maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      execSync(`npx prisma db execute --stdin --url="${databaseUrl}"`, {
        input: 'SELECT 1;',
        stdio: 'ignore',
      });
      return true;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return false;
}

module.exports = async () => {
  // Ensure the Postgres schema is up to date before tests
  // Using `db push` as a more direct way to ensure schema matches for tests.

  // Use DATABASE_URL from environment if set, otherwise use fallback for local development
  const testDatabaseUrl =
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5433/tbtc_relayer?schema=public';

  console.log(
    'Jest Global Setup: Using database:',
    testDatabaseUrl.replace(/\/\/[^@]+@/, '//***:***@'),
  );

  // Wait for PostgreSQL to be ready
  console.log('Jest Global Setup: Waiting for PostgreSQL to be ready...');
  try {
    await waitForPostgres(testDatabaseUrl);
    console.log('Jest Global Setup: PostgreSQL is ready.');
  } catch (error) {
    console.error('Jest Global Setup: PostgreSQL connection failed:', error);
    throw error;
  }

  // Set the test database URL and NODE_ENV for Prisma commands
  const prismaEnv = {
    ...process.env,
    DATABASE_URL: testDatabaseUrl,
    NODE_ENV: 'test', // Ensure Prisma CLI operates in test mode if it has conditional logic
  };

  try {
    console.log('Jest Global Setup: Forcing database schema push...');
    execSync('yarn prisma db push --force-reset --accept-data-loss', {
      env: prismaEnv,
      stdio: 'inherit',
    });
    console.log('Jest Global Setup: Database schema pushed successfully.');

    console.log('Jest Global Setup: Generating Prisma clients...');
    execSync('yarn prisma generate', {
      env: prismaEnv,
      stdio: 'inherit',
    });
    console.log('Jest Global Setup: Prisma clients generated successfully.');
  } catch (error) {
    console.error('Jest Global Setup: Error during Prisma setup:', error);
    throw error; // Rethrow to fail the setup if Prisma commands fail
  }

  console.log('Jest Global Setup: Completed successfully.');
};
