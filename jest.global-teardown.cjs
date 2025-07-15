/* eslint-env node */
/* eslint-disable no-undef */
const { prisma } = require('./utils/prisma');

module.exports = async () => {
  try {
    // Disconnect Prisma client
    await prisma.$disconnect();

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    console.log('Jest Global Teardown: Successfully disconnected all connections');
  } catch (error) {
    console.error('Jest Global Teardown: Error during cleanup:', error);
  }
};
