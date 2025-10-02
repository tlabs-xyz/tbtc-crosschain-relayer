const { execSync } = require('child_process');

module.exports = async () => {
  console.log('Jest Global Teardown: Cleaning up test database...');
  
  try {
    // Stop and remove test database container
    execSync('docker-compose -f tests/docker-compose.test.yml down -v', { 
      stdio: 'inherit',
      cwd: process.cwd()
    });
    
    console.log('Jest Global Teardown: Test database cleanup completed');
  } catch (error) {
    console.error('Jest Global Teardown: Error during cleanup:', error.message);
    // Don't throw error during teardown to avoid masking test failures
  }
};
