const { execSync } = require('child_process');
const { Client } = require('pg');

module.exports = async () => {
  console.log('Jest Global Setup: Starting test database setup...');
  
  try {
    // Start test database
    console.log('Jest Global Setup: Starting PostgreSQL test container...');
    execSync('docker-compose -f tests/docker-compose.test.yml up -d postgres-test', { 
      stdio: 'inherit',
      cwd: process.cwd()
    });
    
    // Wait for database to be ready
    console.log('Jest Global Setup: Waiting for database to be ready...');
    await waitForDatabase();
    
    // Set test database URL
    process.env.DATABASE_URL = 'postgresql://postgres:password@localhost:5433/tbtc_relayer_test';
    
    // Run Prisma migrations
    console.log('Jest Global Setup: Running Prisma migrations...');
    execSync('npx prisma db push --force-reset --accept-data-loss', { 
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL }
    });
    
    console.log('Jest Global Setup: Test database setup completed successfully');
  } catch (error) {
    console.error('Jest Global Setup: Error during setup:', error.message);
    throw error;
  }
};

async function waitForDatabase(maxRetries = 30, delay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const client = new Client({
        connectionString: 'postgresql://postgres:password@localhost:5433/tbtc_relayer_test'
      });
      await client.connect();
      await client.end();
      console.log('Jest Global Setup: Database is ready');
      return;
    } catch (error) {
      if (i === maxRetries - 1) {
        throw new Error(`Database not ready after ${maxRetries} attempts: ${error.message}`);
      }
      console.log(`Jest Global Setup: Waiting for database... (${i + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
