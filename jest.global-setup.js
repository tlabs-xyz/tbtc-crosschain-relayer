const { execSync } = require('child_process');

module.exports = async () => {
  // Ensure the in-memory SQLite schema is up to date before tests
  execSync('npx prisma db push --force-reset --schema=prisma/schema.prisma', {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: 'file:memory:?cache=shared',
    },
  });
}; 