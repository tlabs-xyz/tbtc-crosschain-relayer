const { execSync } = require('child_process');

module.exports = async () => {
  // Ensure the Postgres schema is up to date before tests
  // Using `db push` as a more direct way to ensure schema matches for tests.
  execSync('npx prisma db push --force-reset --accept-data-loss', {
    stdio: 'inherit',
    env: { ...process.env },
  });
};
