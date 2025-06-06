const { execSync } = require('child_process');

module.exports = async () => {
  // Ensure the Postgres schema is up to date before tests
  // Using `db push` as a more direct way to ensure schema matches for tests.

  // Use DATABASE_URL from environment if set, otherwise use fallback for local development
  const testDatabaseUrl =
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/tbtc_relayer?schema=public';

  console.log(
    'Jest Global Setup: Using database:',
    testDatabaseUrl.replace(/\/\/[^@]+@/, '//***:***@'),
  );

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
