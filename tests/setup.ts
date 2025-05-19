import { execSync } from 'child_process';

// Set environment variables for testing
process.env.NODE_ENV = 'test';
process.env.APP_NAME = 'tBTC Relayer Test';
process.env.VERBOSE_APP = 'false'; // Disable verbose logging during tests
process.env.CLEAN_QUEUED_TIME = '1'; // 1 hour for faster testing
process.env.CLEAN_FINALIZED_TIME = '1'; // 1 hour for faster testing
process.env.DATABASE_URL = 'file:memory:?cache=shared';

// Ensure the in-memory SQLite schema is up to date before tests
beforeAll(async () => {
  try {
    execSync('npx prisma db push --force-reset --schema=prisma/schema.test.prisma', { stdio: 'inherit' });
  } catch (err) {
    console.error('Failed to push Prisma schema to in-memory SQLite:', err);
    process.exit(1);
  }
});
