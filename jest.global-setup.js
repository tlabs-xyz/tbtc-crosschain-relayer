const { execSync } = require('child_process');

module.exports = async () => {
  process.env.DATABASE_URL = 'file:memory:?cache=shared';
  try {
    execSync('npx prisma db push --force-reset --schema=prisma/schema.test.prisma', { stdio: 'inherit', env: process.env });
  } catch (err) {
    console.error('Failed to push Prisma schema to in-memory SQLite:', err);
    process.exit(1);
  }
}; 